import { serviceUrl } from "@panas/contracts/service-url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { publicProviderPageSchema } from "@panas/contracts/public-registry";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PLATFORM } from "./config.js";
import {
    probeFrontend,
    probeFunctions,
    type FunctionDeployment,
    assertOperationalHealth,
    VerificationError,
    verificationError,
    type VerificationStage,
    type FrontendDeployment,
} from "./release-probe.js";
import {
    assertClean,
    assertProjectBinding,
    management,
    ManagementRequestError,
    invokeOperations,
    revision,
    root,
    run,
    volcano,
} from "./runtime.js";

export interface ReleaseCheck {
    name: string;
    passed: true;
    endpoint?: string;
    status?: number;
}
function ensure(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}
async function request(url: string, init: RequestInit = {}) {
    try {
        return await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        throw new Error("Release endpoint request failed");
    }
}
async function readinessManagement<T>(
    stage: VerificationStage,
    path: string,
    signal: AbortSignal,
): Promise<T> {
    try {
        return await management<T>(path, { signal });
    } catch (error) {
        if (error instanceof ManagementRequestError)
            throw new VerificationError(
                stage,
                error.status ? "HTTP_STATUS" : "REQUEST_FAILED",
                undefined,
                error.status,
            );
        throw error;
    }
}
async function probeRelease(
    frontend: boolean,
    migration: Record<string, unknown>,
    checking: (stage: VerificationStage) => void,
    failures: unknown[],
) {
    await assertProjectBinding();
    assertClean();
    const checks: ReleaseCheck[] = [];
    function reportRetry(failure: VerificationError, attempt: number) {
        const diagnostic = { ...failure.diagnostic, attempt };
        failures.push(diagnostic);
        console.warn(
            JSON.stringify({ event: "release_readiness_retry", ...diagnostic }),
        );
    }
    checking("anonymous_public_api");
    const publicUrl = `${PLATFORM.registryUrl}/public/providers?limit=1`;
    const publicResponse = await request(publicUrl, {
        headers: { Origin: "https://panas.example" },
    });
    ensure(
        publicResponse.status === 200,
        "Anonymous public registry is unavailable",
    );
    publicProviderPageSchema.parse(await publicResponse.json());
    ensure(
        publicResponse.headers.get("access-control-allow-origin") === "*" &&
            publicResponse.headers.get("cache-control")?.includes("no-store"),
        "Public CORS/cache policy differs",
    );
    checks.push({
        name: "anonymous_public_api",
        passed: true,
        endpoint: publicUrl,
        status: 200,
    });
    checking("anonymous_api_authorization");
    const denied = await request(`${PLATFORM.registryUrl}/providers`);
    ensure(
        denied.status === 401,
        "Private discovery accepted an anonymous request",
    );
    checks.push({
        name: "anonymous_api_authorization",
        passed: true,
        status: 401,
    });
    checking("accounting_authorization");
    const accounting = await request(`${PLATFORM.accountingUrl}/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
    });
    ensure(
        accounting.status === 401,
        "Accounting did not reject an unsigned request",
    );
    checks.push({
        name: "accounting_authorization",
        passed: true,
        status: 401,
    });
    checking("authenticated_mcp");
    const secret = process.env.PANAS_DISCOVERY_TOKEN?.trim();
    ensure(
        secret,
        "Read-only discovery credential required for actual MCP probe",
    );
    const client = new Client({
        name: "panas-release-verifier",
        version: "1.0.0",
    });
    try {
        await client.connect(
            new StreamableHTTPClientTransport(
                serviceUrl(PLATFORM.registryUrl, "/mcp"),
                {
                    requestInit: {
                        headers: { authorization: `Bearer ${secret}` },
                    },
                },
            ),
        );
        const list = await client.listTools();
        ensure(
            ["discover_providers", "get_provider"].every((name) =>
                list.tools.some((tool) => tool.name === name),
            ),
            "Discovery MCP tool contract differs",
        );
        const result = await client.callTool(
            {
                name: "discover_providers",
                arguments: { readyOnly: true, limit: 1 },
            },
            undefined,
            { timeout: 15000 },
        );
        ensure(
            !result.isError && result.structuredContent,
            "Structured MCP discovery failed",
        );
    } catch {
        throw new Error("Authenticated official MCP client probe failed");
    } finally {
        await client.close();
    }
    checks.push({
        name: "authenticated_mcp",
        passed: true,
        endpoint: `${PLATFORM.registryUrl}/mcp`,
    });
    checking("functions_deployment");
    const functionProbe = await probeFunctions({
        projectId: PLATFORM.projectId,
        load: async (signal) =>
            (
                await readinessManagement<{ data: FunctionDeployment[] }>(
                    "functions_deployment",
                    `/projects/${PLATFORM.projectId}/functions`,
                    signal,
                )
            ).data,
        onRetry: reportRetry,
    });
    const functions = functionProbe.records;
    checking("private_operational_health");
    const operation = functions.find((fn) => fn.name === "operations")!;
    const invocation = (await invokeOperations(operation, {
        job: "health",
    })) as { payload?: unknown; result?: unknown };
    let health: unknown = invocation.payload ?? invocation.result ?? invocation;
    if (typeof health === "string") {
        try {
            health = JSON.parse(health);
        } catch {
            throw new Error("Operational health returned invalid JSON");
        }
    }
    assertOperationalHealth(health, revision());
    checks.push({ name: "private_operational_health", passed: true });
    let frontendRecord: FrontendDeployment | undefined;
    let frontendProbe: { assetCount: number; attempts: number } | undefined;
    if (frontend) {
        checking("frontend");
        const result = await probeFrontend({
            url: PLATFORM.frontendUrl,
            frontendId: PLATFORM.frontendId,
            projectId: PLATFORM.projectId,
            onStage: checking,
            deployment: async (signal) => {
                const records = await readinessManagement<{
                    data: FrontendDeployment[];
                }>(
                    "frontend_deployment",
                    `/projects/${PLATFORM.projectId}/frontends`,
                    signal,
                );
                return records.data.find((f) => f.name === "panas");
            },
            onRetry: reportRetry,
        });
        frontendRecord = result.record;
        frontendProbe = {
            assetCount: result.assetCount,
            attempts: result.attempts,
        };
        checks.push(
            {
                name: "frontend",
                passed: true,
                endpoint: PLATFORM.frontendUrl,
                status: 200,
            },
            { name: "frontend_assets", passed: true, status: 200 },
        );
    }
    const release = {
        schemaVersion: 1,
        scope: frontend ? "panas-test" : "panas-test-backend",
        projectId: PLATFORM.projectId,
        commit: revision(),
        verifiedAt: new Date().toISOString(),
        status: "verified",
        versions: {
            node: process.versions.node,
            pnpm: run("pnpm", ["--version"], true).trim(),
            volcano: run(volcano, ["--version"], true).trim(),
            next: (
                JSON.parse(
                    await readFile(
                        resolve(root, "apps/web/package.json"),
                        "utf8",
                    ),
                ) as { dependencies: { next: string } }
            ).dependencies.next,
        },
        lockfileSha256: createHash("sha256")
            .update(await readFile(resolve(root, "pnpm-lock.yaml")))
            .digest("hex"),
        functions: functions
            .filter((f) =>
                ["health", "registry", "accounting", "operations"].includes(
                    f.name,
                ),
            )
            .map((f) => ({
                name: f.name,
                id: f.id,
                deploymentId: f.current_deployment_id,
                ...(["registry", "accounting"].includes(f.name)
                    ? {
                          invokeUrl:
                              f.name === "registry"
                                  ? PLATFORM.registryUrl
                                  : PLATFORM.accountingUrl,
                      }
                    : {}),
            })),
        ...(frontendRecord
            ? {
                  frontend: {
                      name: frontendRecord.name,
                      id: frontendRecord.id,
                      deploymentId: frontendRecord.current_deployment_id,
                      url: PLATFORM.frontendUrl,
                  },
              }
            : {}),
        checks,
        functionProbe: { attempts: functionProbe.attempts },
        ...(frontendProbe ? { frontendProbe } : {}),
        migration,
    };
    await mkdir(resolve(root, "artifacts"), { recursive: true });
    await writeFile(
        resolve(
            root,
            "artifacts",
            frontend ? "release.json" : "backend-release.json",
        ),
        JSON.stringify(release, null, 2) + "\n",
    );
    console.log(
        JSON.stringify({
            status: "verified",
            scope: release.scope,
            commit: release.commit,
            checks: checks.map((check) => check.name),
        }),
    );
    return release;
}
export async function verifyRelease(
    frontend = false,
    migration: Record<string, unknown> = { mode: "tracked" },
) {
    let stage: VerificationStage = "release_setup";
    const failures: unknown[] = [];
    function checking(next: VerificationStage) {
        stage = next;
        console.log(`Checking ${next}`);
    }
    async function diagnostics(status: "verified" | "failed") {
        await mkdir(resolve(root, "artifacts"), { recursive: true });
        await writeFile(
            resolve(root, "artifacts/verification.json"),
            JSON.stringify({ schemaVersion: 1, status, failures }, null, 2) +
                "\n",
        );
    }
    try {
        const release = await probeRelease(
            frontend,
            migration,
            checking,
            failures,
        );
        await diagnostics("verified");
        return release;
    } catch (error) {
        const failure = verificationError(error, stage);
        failures.push(failure.diagnostic);
        await diagnostics("failed");
        console.error(
            JSON.stringify({
                event: "release_verification_failed",
                ...failure.diagnostic,
            }),
        );
        throw failure;
    }
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
    await verifyRelease(false);
