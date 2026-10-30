import { describe, it, expect } from "vitest";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { once } from "node:events";
import {
    probeFrontend,
    probeFunctions,
    assertOperationalHealth,
    VerificationError,
    verificationError,
} from "../../scripts/platform/release-probe.js";

async function fixture(
    handle: (request: IncomingMessage, response: ServerResponse) => void,
) {
    const server = createServer(handle);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("NO_FIXTURE_PORT");
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            ),
    };
}
function clock() {
    let time = 0;
    return {
        now: () => time,
        sleep: async (ms: number) => {
            time += ms;
        },
        timeoutMs: 30000,
        retryMs: 10000,
    };
}
function record(url: string, status = "active") {
    return {
        id: "frontend",
        name: "panas",
        project_id: "project",
        site_url: url,
        status,
        current_deployment_id: "deployment",
    };
}
function html(paths: string[]) {
    return `<html>panas${paths.map((p) => `<script src="${p}"></script>`).join("")}</html>`;
}

describe("frontend rollout boundary", () => {
    it("binds custom-domain verification to the exact frontend ID", async () => {
        const app = await fixture((req, res) => {
            if (req.url === "/") res.end(html(["/_next/static/a.js"]));
            else {
                res.setHeader("content-type", "text/javascript");
                res.end("asset");
            }
        });
        try {
            const options = {
                url: app.url,
                frontendId: "frontend",
                projectId: "project",
                ...clock(),
                deployment: async () =>
                    record("https://internal-origin.invalid"),
            };
            expect((await probeFrontend(options)).record.id).toBe("frontend");
            await expect(
                probeFrontend({ ...options, frontendId: "other-frontend" }),
            ).rejects.toMatchObject({
                diagnostic: {
                    stage: "frontend_deployment",
                    code: "CHECK_FAILED",
                },
            });
        } finally {
            await app.close();
        }
    });
    it("refreshes stale HTML, checks every asset, and waits for management readiness", async () => {
        let pages = 0,
            metadata = 0;
        const requested: string[] = [];
        const app = await fixture((req, res) => {
            const path = req.url!;
            requested.push(path);
            if (path === "/") {
                res.setHeader("content-type", "text/html");
                res.end(
                    html(
                        ++pages === 1
                            ? ["/_next/static/old.js"]
                            : Array.from(
                                  { length: 5 },
                                  (_, i) => `/_next/static/${i}.js`,
                              ),
                    ),
                );
            } else if (path.includes("old.js")) {
                res.writeHead(404);
                res.end("old generation");
            } else {
                res.setHeader("content-type", "text/javascript");
                res.end("void 0;");
            }
        });
        const diagnostics: unknown[] = [];
        try {
            const result = await probeFrontend({
                url: app.url,
                projectId: "project",
                ...clock(),
                deployment: async () =>
                    record(
                        app.url,
                        ++metadata === 1 ? "provisioning" : "active",
                    ),
                onRetry: (e) => diagnostics.push(e.diagnostic),
            });
            expect(result).toMatchObject({ assetCount: 5, attempts: 3 });
            expect(requested.filter((p) => p.includes("old.js"))).toHaveLength(
                1,
            );
            expect(
                requested.filter((p) => p === "/_next/static/4.js"),
            ).toHaveLength(2);
            expect(diagnostics).toEqual([
                {
                    stage: "frontend_assets",
                    code: "HTTP_STATUS",
                    path: "/_next/static/old.js",
                    status: 404,
                },
                { stage: "frontend_deployment", code: "DEPLOYMENT_NOT_ACTIVE" },
            ]);
        } finally {
            await app.close();
        }
    });
    it("fails persistent missing assets within the deadline without logging queries, headers or error bodies", async () => {
        const secret = "PRIVATE_TEST_CREDENTIAL";
        let requests = 0;
        const app = await fixture((req, res) => {
            requests++;
            if (req.url === "/")
                res.end(html([`/_next/static/missing.js?token=${secret}`]));
            else {
                res.writeHead(404);
                res.end(secret);
            }
        });
        const failures: unknown[] = [];
        try {
            const error = await probeFrontend({
                url: app.url,
                projectId: "project",
                ...clock(),
                deployment: async () => record(app.url),
                onRetry: (e) => failures.push(e.diagnostic),
            }).catch((e) => e);
            expect(error).toBeInstanceOf(VerificationError);
            expect(error.diagnostic).toEqual({
                stage: "frontend_assets",
                code: "HTTP_STATUS",
                path: "/_next/static/missing.js",
                status: 404,
            });
            expect(requests).toBe(6);
            expect(JSON.stringify({ failures, error })).not.toContain(secret);
            expect(
                verificationError(
                    new Error(secret),
                    "private_operational_health",
                ).diagnostic,
            ).toEqual({
                stage: "private_operational_health",
                code: "CHECK_FAILED",
            });
        } finally {
            await app.close();
        }
    });
    it("never requests an external asset and does not retry a policy failure", async () => {
        let requests = 0;
        const app = await fixture((_req, res) => {
            requests++;
            res.end(
                html([
                    "https://untrusted.invalid/_next/static/a.js?token=PRIVATE",
                ]),
            );
        });
        try {
            await expect(
                probeFrontend({
                    url: app.url,
                    projectId: "project",
                    ...clock(),
                    deployment: async () => record(app.url),
                }),
            ).rejects.toMatchObject({
                diagnostic: {
                    stage: "frontend_assets",
                    code: "UNTRUSTED_ASSET",
                },
            });
            expect(requests).toBe(1);
        } finally {
            await app.close();
        }
    });
    it("retries a management 503 and rejects an HTML error page masquerading as a successful asset", async () => {
        let metadata = 0;
        let badAsset = false;
        const app = await fixture((req, res) => {
            if (req.url === "/") res.end(html(["/_next/static/a.js"]));
            else {
                res.setHeader(
                    "content-type",
                    badAsset ? "text/html" : "text/javascript",
                );
                res.end("response");
            }
        });
        try {
            const result = await probeFrontend({
                url: app.url,
                projectId: "project",
                ...clock(),
                deployment: async () => {
                    if (++metadata === 1)
                        throw new VerificationError(
                            "frontend_deployment",
                            "HTTP_STATUS",
                            undefined,
                            503,
                        );
                    return record(app.url);
                },
            });
            expect(result.attempts).toBe(2);
            badAsset = true;
            await expect(
                probeFrontend({
                    url: app.url,
                    projectId: "project",
                    ...clock(),
                    deployment: async () => record(app.url),
                }),
            ).rejects.toMatchObject({
                diagnostic: {
                    stage: "frontend_assets",
                    code: "INVALID_CONTENT",
                },
            });
        } finally {
            await app.close();
        }
    });
});

it("fails closed on a wrong release and either financial invariant", () => {
    const healthy = {
        ok: true,
        releaseSha: "expected",
        ledgerImbalanceCount: 0,
        heldMismatchCount: 0,
    };
    expect(() => assertOperationalHealth(healthy, "expected")).not.toThrow();
    for (const bad of [
        { ...healthy, releaseSha: "old" },
        { ...healthy, ledgerImbalanceCount: 1 },
        { ...healthy, heldMismatchCount: 1 },
    ]) {
        expect(() => assertOperationalHealth(bad, "expected")).toThrow(
            VerificationError,
        );
    }
});

it("waits for backend resource metadata separately and names a stuck function", async () => {
    const names = ["health", "registry", "accounting", "operations"];
    const records = names.map((name) => ({
        id: name,
        name,
        project_id: "project",
        status: "active",
        invoke_url: "https://example.invalid",
        current_deployment_id: "deployment",
    }));
    let requests = 0;
    const failures: unknown[] = [];
    const result = await probeFunctions({
        projectId: "project",
        ...clock(),
        load: async () => {
            requests++;
            return records.map((r) => ({
                ...r,
                status:
                    r.name === "registry" && requests === 1
                        ? "provisioning"
                        : r.status,
            }));
        },
        onRetry: (e) => failures.push(e.diagnostic),
    });
    expect(result.attempts).toBe(2);
    expect(failures).toEqual([
        {
            stage: "functions_deployment",
            code: "DEPLOYMENT_NOT_ACTIVE",
            resource: "registry",
            resourceState: "provisioning",
        },
    ]);
    await expect(
        probeFunctions({
            projectId: "project",
            ...clock(),
            load: async () => records.filter((r) => r.name !== "registry"),
        }),
    ).rejects.toMatchObject({
        diagnostic: {
            stage: "functions_deployment",
            code: "DEPLOYMENT_NOT_ACTIVE",
            resource: "registry",
        },
    });
    await expect(
        probeFunctions({
            projectId: "project",
            ...clock(),
            load: async () =>
                records.map((r) => ({ ...r, project_id: "wrong" })),
        }),
    ).rejects.toMatchObject({
        diagnostic: {
            stage: "functions_deployment",
            code: "CHECK_FAILED",
            resource: "health",
        },
    });
});
