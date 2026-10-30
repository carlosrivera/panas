import {
    mkdtemp,
    writeFile,
    readFile,
    readdir,
    lstat,
    rm,
    symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
    DOMAIN,
    demoBuyerId,
    signDocument,
    verifyDocument,
    demoEnrollmentSchema,
} from "@panas/protocol";
import {
    enrollDemo,
    ensureDemoSession,
    installMcpClient,
    mergeMcpJson,
    prepareDemoConfig,
    writeConfigFile,
} from "./client-setup.js";

it("merges only Panas into Antigravity and preserves unrelated settings and servers", async () => {
    const home = await mkdtemp(join(tmpdir(), "panas-client-test-"));
    const path = join(home, ".gemini/config/mcp_config.json");
    try {
        const before = {
            theme: "custom",
            mcpServers: {
                existing: {
                    command: "existing",
                    env: { TOKEN: "fixture-private" },
                },
            },
        };
        await writeConfigFile(path, JSON.stringify(before));
        const configurationFile = await installMcpClient({
            home,
            client: "antigravity",
            envPath: "/private/demo.env",
            nodePath: "/absolute/node",
            cliPath: "/absolute/panas.js",
        });
        expect(configurationFile).toBe(path);
        const after = JSON.parse(await readFile(path, "utf8"));
        expect(after.theme).toBe(before.theme);
        expect(after.mcpServers.existing).toEqual(before.mcpServers.existing);
        expect(after.mcpServers.panas).toEqual({
            command: "/absolute/node",
            args: [
                "/absolute/panas.js",
                "buyer",
                "--env-file",
                "/private/demo.env",
            ],
        });
        expect((await lstat(path)).mode & 0o777).toBe(0o600);
        const backups = (await readdir(join(home, ".gemini/config"))).filter(
            (name) => name.includes("panas-backup"),
        );
        expect(backups).toHaveLength(1);
        expect(
            JSON.parse(
                await readFile(
                    join(home, ".gemini/config", backups[0]!),
                    "utf8",
                ),
            ),
        ).toEqual(before);
        await installMcpClient({
            home,
            client: "antigravity",
            envPath: "/private/demo.env",
            nodePath: "/absolute/node",
            cliPath: "/absolute/panas.js",
        });
        expect(
            (await readdir(join(home, ".gemini/config"))).filter((name) =>
                name.includes("panas-backup"),
            ),
        ).toHaveLength(1);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

it("does not replace malformed JSON, arrays or symlink configuration files", async () => {
    expect(() => mergeMcpJson("[]", { command: "/node", args: [] })).toThrow();
    expect(() =>
        mergeMcpJson('{"mcpServers":[]}', { command: "/node", args: [] }),
    ).toThrow();
    expect(() =>
        mergeMcpJson("not JSON", { command: "/node", args: [] }),
    ).toThrow();
    const home = await mkdtemp(join(tmpdir(), "panas-config-test-"));
    try {
        await writeFile(join(home, "original"), "preserve");
        await symlink(join(home, "original"), join(home, "link"));
        await expect(
            writeConfigFile(join(home, "link"), "replace"),
        ).rejects.toThrow();
        expect(await readFile(join(home, "original"), "utf8")).toBe("preserve");
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

it("creates separate zero-spend demo stores without altering enrolled owner authority", async () => {
    const home = await mkdtemp(join(tmpdir(), "panas-free-config-"));
    try {
        const key = generateKeyPairSync("ed25519");
        const privateKeyPath = join(home, "buyer.pem"),
            platformPublicKeyPath = join(home, "platform.pem"),
            discoveryTokenPath = join(home, "token");
        await writeFile(
            privateKeyPath,
            key.privateKey.export({ type: "pkcs8", format: "pem" }),
            { mode: 0o600 },
        );
        await writeFile(
            platformPublicKeyPath,
            key.publicKey.export({ type: "spki", format: "pem" }),
            { mode: 0o600 },
        );
        await writeFile(discoveryTokenPath, "fixture-private-token", {
            mode: 0o600,
        });
        const owner = {
            buyerId: randomUUID(),
            sessionId: randomUUID(),
            privateKeyPath,
            platformPublicKeyPath,
            discoveryTokenPath,
            dataDir: join(home, "original-state"),
            accountingUrl: "https://accounting.test",
            registryUrl: "https://registry.test",
            limits: {
                maxRequestAtomic: "10",
                maxSessionAtomic: "20",
                maxDailyAtomic: "30",
            },
        };
        const ownerPath = join(home, "owner.json");
        await writeFile(ownerPath, JSON.stringify(owner), { mode: 0o600 });
        const a = await prepareDemoConfig({ home, ownerPath, client: "codex" });
        const b = await prepareDemoConfig({
            home,
            ownerPath,
            client: "antigravity",
        });
        const codex = JSON.parse(
            await readFile(join(a.directory, "buyer.json"), "utf8"),
        );
        const antigravity = JSON.parse(
            await readFile(join(b.directory, "buyer.json"), "utf8"),
        );
        expect(codex.limits).toEqual({
            maxRequestAtomic: "0",
            maxSessionAtomic: "0",
            maxDailyAtomic: "0",
        });
        expect(codex.dataDir).not.toBe(antigravity.dataDir);
        expect(JSON.parse(await readFile(ownerPath, "utf8"))).toEqual(owner);
        await expect(
            prepareDemoConfig({
                home,
                ownerPath: join(home, "missing"),
                client: "codex",
            }),
        ).rejects.toThrow(
            "existing enrolled buyer configuration could not be read safely",
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

it("enrolls a first-time buyer privately, keeps stable identity on retry and refuses server key rotation", async () => {
    const home = await mkdtemp(join(tmpdir(), "panas-enroll-test-"));
    let platform = generateKeyPairSync("ed25519");
    const publicKeys: string[] = [];
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
        const proof = demoEnrollmentSchema.parse(
            JSON.parse(String(init?.body)),
        );
        expect(
            verifyDocument(
                DOMAIN.enrollment,
                proof,
                proof.payload.publicKeyPem,
            ),
        ).toBe(true);
        expect(String(init?.body)).not.toContain("PRIVATE KEY");
        publicKeys.push(proof.payload.publicKeyPem);
        const buyerId = demoBuyerId(proof.payload.publicKeyPem),
            sessionId = proof.payload.sessionId,
            expiresAt = new Date(Date.now() + 86400000).toISOString();
        const token = signDocument(
            DOMAIN.discovery,
            {
                version: 1,
                scope: "free-discovery",
                buyerId,
                sessionId,
                issuedAt: new Date().toISOString(),
                expiresAt,
            },
            platform.privateKey,
        );
        return Response.json({
            buyerId,
            sessionId,
            expiresAt,
            platformPublicKeyPem: platform.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            discoveryToken: `demo1.${Buffer.from(JSON.stringify(token)).toString("base64url")}`,
            freeOnly: true,
        });
    });
    try {
        const options = {
            home,
            client: "codex" as const,
            fetcher: fetcher as typeof fetch,
        };
        const a = await enrollDemo(options),
            b = await enrollDemo(options);
        expect(a).toEqual(b);
        await ensureDemoSession(options);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(new Set(publicKeys).size).toBe(1);
        const owner = JSON.parse(
            await readFile(join(a.directory, "buyer.json"), "utf8"),
        );
        expect(Object.values(owner.limits)).toEqual(["0", "0", "0"]);
        expect((await lstat(owner.privateKeyPath)).mode & 0o777).toBe(0o600);
        const anchor = await readFile(owner.platformPublicKeyPath, "utf8");
        platform = generateKeyPairSync("ed25519");
        await expect(enrollDemo(options)).rejects.toThrow(
            "signing key changed",
        );
        expect(await readFile(owner.platformPublicKeyPath, "utf8")).toBe(
            anchor,
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
