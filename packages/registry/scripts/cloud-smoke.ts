import { serviceUrl } from "@panas/contracts/service-url";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signProviderRequest } from "../src/auth.js";
import { fixtureReport } from "../src/fixtures.js";

const url =
    process.env.PANAS_REGISTRY_URL ?? "https://panas.mcpwire.co/registry";
const token = process.env.PANAS_DISCOVERY_TOKEN;
const connectionString = process.env.PANAS_REGISTRY_DATABASE_URL;
if (!url || !token || !connectionString)
    throw new Error(
        "Configure registry endpoint, read-only discovery token, and operator database environment",
    );
const id = randomUUID();
const keys = generateKeyPairSync("ed25519");
const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
});
const client = new Client({ name: "panas-cloud-smoke", version: "0.1.0" });
async function signedPost(path: string, value: unknown) {
    const raw = JSON.stringify(value);
    const proof = signProviderRequest(
        keys.privateKey,
        id,
        path,
        raw,
        String(Date.now()),
        randomUUID(),
    );
    const response = await fetch(serviceUrl(url, path), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-panas-provider-id": id,
            "x-panas-timestamp": proof.timestamp,
            "x-panas-nonce": proof.nonce,
            "x-panas-signature": proof.signature,
        },
        body: raw,
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
        throw new Error(`Signed ${path} failed: ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
}
try {
    await pool.query(
        "INSERT INTO panas_provider_keys(provider_id,public_key_pem) VALUES($1,$2)",
        [id, keys.publicKey.export({ type: "spki", format: "pem" }).toString()],
    );
    const unauthorized = await fetch(serviceUrl(url, "/providers"));
    if (unauthorized.status !== 401)
        throw new Error(`Expected401, received ${unauthorized.status}`);
    const report = fixtureReport(new Date(), id);
    report.state = "testing";
    report.peerProbe = { status: "unverified" };
    report.benchmark = null;
    report.model.digest = null;
    report.model.runtimeVersion = null;
    report.checks = report.checks.map((c) => ({
        ...c,
        passed: false,
        detail: "cloud API smoke fixture; hardware not tested",
    }));
    const registration = await signedPost("/providers/register", {
        report,
        price: {
            version: "smoke-v1",
            totalAtomic: "1",
            currency: "TEST_CREDIT",
        },
    });
    await signedPost("/providers/heartbeat", {
        providerId: id,
        startupId: report.startupId,
        sequence: 1,
        reportDigest: registration.reportDigest,
        state: "testing",
    });
    await client.connect(
        new StreamableHTTPClientTransport(serviceUrl(url, "/mcp"), {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
        }),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    if (
        !names.includes("discover_providers") ||
        !names.includes("get_provider")
    )
        throw new Error("Discovery tool missing");
    const ready = await client.callTool({
        name: "discover_providers",
        arguments: { readyOnly: true },
    });
    if (ready.isError) throw new Error("Ready discovery failed");
    if (JSON.stringify(ready).includes(id))
        throw new Error("Unverified smoke provider appeared ready");
    const found = await client.callTool({
        name: "get_provider",
        arguments: { providerId: id },
    });
    if (found.isError || !JSON.stringify(found).includes(id))
        throw new Error("Provider retrieval failed");
    console.log(
        "Verified deployed auth rejection, signed registration/heartbeat, MCP initialize/list/discover/get, and unverified readiness exclusion.",
    );
} finally {
    await client.close();
    for (const table of [
        "panas_registry_nonces",
        "panas_registry_current",
        "panas_registry_reports",
        "panas_provider_keys",
    ])
        await pool.query(`DELETE FROM ${table} WHERE provider_id=$1`, [id]);
    await pool.end();
}
