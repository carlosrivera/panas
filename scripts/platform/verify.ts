import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { publicProviderPageSchema } from "@panas/contracts/public-registry";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PLATFORM } from "./config.js";
import {
    assertClean,
    assertProjectBinding,
    management,
    invokeOperations,
    revision,
    root,
    run,
    volcano,
} from "./runtime.js";

interface CloudFunction {
    id: string;
    project_id: string;
    name: string;
    status: string;
    invoke_url: string;
    current_deployment_id: string | null;
}
interface CloudFrontend {
    id: string;
    project_id: string;
    name: string;
    status: string;
    site_url: string;
    current_deployment_id: string | null;
}
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
export async function verifyRelease(
    frontend = true,
    migration: Record<string, unknown> = { mode: "tracked" },
) {
    await assertProjectBinding();
    assertClean();
    const checks: ReleaseCheck[] = [];
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
    const secret = process.env.PANAS_DISCOVERY_TOKEN;
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
                new URL("/mcp", PLATFORM.registryUrl),
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
    const functions = (
        await management<{ data: CloudFunction[] }>(
            `/projects/${PLATFORM.projectId}/functions`,
        )
    ).data;
    for (const name of ["health", "registry", "accounting", "operations"]) {
        const fn = functions.find((fn) => fn.name === name);
        ensure(
            fn?.project_id === PLATFORM.projectId &&
                fn.status === "active" &&
                fn.current_deployment_id,
            `Function ${name} has no active deployment`,
        );
    }
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
    const operational = health as {
        ok?: boolean;
        releaseSha?: string;
        ledgerImbalanceCount?: number;
        heldMismatchCount?: number;
    };
    ensure(
        operational.ok === true &&
            operational.releaseSha === revision() &&
            operational.ledgerImbalanceCount === 0 &&
            operational.heldMismatchCount === 0,
        "Private operational health/release identity failed",
    );
    checks.push({ name: "private_operational_health", passed: true });
    let frontendRecord: CloudFrontend | undefined;
    if (frontend) {
        const page = await request(PLATFORM.frontendUrl);
        ensure(page.status === 200, "Frontend page failed");
        const html = await page.text();
        ensure(
            html.toLowerCase().includes("panas"),
            "Frontend content missing",
        );
        checks.push({
            name: "frontend",
            passed: true,
            endpoint: PLATFORM.frontendUrl,
            status: 200,
        });
        const assets = [
            ...new Set(
                [
                    ...html.matchAll(
                        /(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g,
                    ),
                ].map((match) => match[1]!),
            ),
        ].slice(0, 4);
        ensure(assets.length > 0, "No built frontend assets found");
        for (const path of assets) {
            const url = new URL(path, PLATFORM.frontendUrl);
            ensure(
                url.origin === new URL(PLATFORM.frontendUrl).origin,
                "External asset in release probe",
            );
            const asset = await request(url.href);
            ensure(asset.status === 200, "Built frontend asset failed");
        }
        checks.push({ name: "frontend_assets", passed: true, status: 200 });
        frontendRecord = (
            await management<{ data: CloudFrontend[] }>(
                `/projects/${PLATFORM.projectId}/frontends`,
            )
        ).data.find((f) => f.name === "panas");
        ensure(
            frontendRecord?.project_id === PLATFORM.projectId &&
                frontendRecord.status === "active" &&
                frontendRecord.current_deployment_id,
            "No active frontend deployment",
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
                invokeUrl: f.invoke_url,
            })),
        ...(frontendRecord
            ? {
                  frontend: {
                      name: frontendRecord.name,
                      id: frontendRecord.id,
                      deploymentId: frontendRecord.current_deployment_id,
                      url: frontendRecord.site_url,
                  },
              }
            : {}),
        checks,
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
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
    await verifyRelease(!process.argv.includes("--functions-only"));
