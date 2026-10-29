import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
it("starts the actual private-config stdio facade and closes its owner store cleanly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panas-buyer-stdio-"));
    const buyer = generateKeyPairSync("ed25519"),
        platform = generateKeyPairSync("ed25519");
    const privateKeyPath = join(dir, "buyer.pem"),
        platformPublicKeyPath = join(dir, "platform.pem"),
        discoveryTokenPath = join(dir, "token"),
        dataDir = join(dir, "data"),
        configPath = join(dir, "config.json");
    for (const [path, content] of [
        [
            privateKeyPath,
            buyer.privateKey
                .export({ type: "pkcs8", format: "pem" })
                .toString(),
        ],
        [
            platformPublicKeyPath,
            platform.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
        ],
        [discoveryTokenPath, "fixture-private-discovery-token"],
    ])
        writeFileSync(path!, content!, { mode: 0o600 });
    writeFileSync(
        configPath,
        JSON.stringify({
            buyerId: randomUUID(),
            sessionId: randomUUID(),
            privateKeyPath,
            platformPublicKeyPath,
            discoveryTokenPath,
            dataDir,
            registryUrl: "https://registry.invalid",
            accountingUrl: "https://accounting.invalid",
            limits: {
                maxRequestAtomic: "10",
                maxSessionAtomic: "20",
                maxDailyAtomic: "30",
            },
        }),
        { mode: 0o600 },
    );
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            "--import",
            "tsx",
            fileURLToPath(new URL("./cli.ts", import.meta.url)),
        ],
        env: { ...process.env, PANAS_BUYER_CONFIG: configPath },
        stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
        diagnostics += chunk.toString();
    });
    const client = new Client({ name: "buyer-stdio-test", version: "1" });
    try {
        await client.connect(transport);
        expect((await client.listTools()).tools).toHaveLength(7);
        expect(existsSync(join(dataDir, "writer.lock"))).toBe(true);
    } finally {
        await client.close();
    }
    try {
        expect(existsSync(join(dataDir, "writer.lock"))).toBe(false);
        expect(diagnostics).not.toContain("fixture-private-discovery-token");
        expect(diagnostics).not.toContain("PRIVATE KEY");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 10000);
