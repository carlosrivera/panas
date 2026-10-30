import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DOMAIN, signDocument } from "@panas/protocol";
import { RegistryService } from "./service";
import { createHttpHandler } from "./http";
import { fixtureRecord } from "./fixtures";
import type { RegistryRepository } from "./repository";

const now = new Date("2026-10-29T01:00:00Z");
const token = "fixture-discovery-secret";
const hash = createHash("sha256").update(token).digest("hex");
function setup() {
    const row = fixtureRecord(now);
    const repo: RegistryRepository = {
        getKey: vi.fn(),
        register: vi.fn(),
        heartbeat: vi.fn(),
        get: vi.fn(async () => row),
        discover: vi.fn(async () => [row]),
    };
    const service = new RegistryService(repo, () => now);
    const handle = createHttpHandler(service, hash);
    return { handle, repo, row, service };
}
describe("authenticated shared API and stateless MCP discovery", () => {
    it("blocks unauthenticated/browser callers before repository access", async () => {
        const { handle, repo } = setup();
        expect(
            (await handle(new Request("https://registry.test/providers")))
                .status,
        ).toBe(401);
        expect(
            (
                await handle(
                    new Request("https://registry.test/providers", {
                        headers: {
                            authorization: `Bearer ${token}`,
                            origin: "https://untrusted.test",
                        },
                    }),
                )
            ).status,
        ).toBe(403);
        expect(repo.discover).not.toHaveBeenCalled();
    });
    it("scopes demo tokens to free providers and rejects tampered or expired discovery authority", async () => {
        const { service, repo, row } = setup();
        const platform = generateKeyPairSync("ed25519");
        const handle = createHttpHandler(
            service,
            hash,
            platform.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
        );
        const nowMs = Date.now();
        const signed = signDocument(
            DOMAIN.discovery,
            {
                version: 1,
                scope: "free-discovery",
                buyerId: randomUUID(),
                sessionId: randomUUID(),
                issuedAt: new Date(nowMs).toISOString(),
                expiresAt: new Date(nowMs + 86400000).toISOString(),
            },
            platform.privateKey,
        );
        const token = `demo1.${Buffer.from(JSON.stringify(signed)).toString("base64url")}`;
        const request = (path: string, bearer = token) =>
            handle(
                new Request(`https://registry.test${path}`, {
                    headers: { authorization: `Bearer ${bearer}` },
                }),
            );
        expect((await request("/providers?maxPriceAtomic=10000")).status).toBe(
            200,
        );
        expect(repo.discover).toHaveBeenLastCalledWith(
            expect.objectContaining({ maxPriceAtomic: "0" }),
            null,
            expect.anything(),
            expect.anything(),
        );
        row.price.totalAtomic = "100";
        expect((await request(`/providers/${row.providerId}`)).status).toBe(
            403,
        );
        const forged = {
            ...signed,
            payload: { ...signed.payload, scope: "paid" },
        };
        expect(
            (
                await request(
                    "/providers",
                    `demo1.${Buffer.from(JSON.stringify(forged)).toString("base64url")}`,
                )
            ).status,
        ).toBe(401);
        const expired = signDocument(
            DOMAIN.discovery,
            {
                ...signed.payload,
                issuedAt: new Date(nowMs - 86400000).toISOString(),
                expiresAt: new Date(nowMs - 1).toISOString(),
            },
            platform.privateKey,
        );
        expect(
            (
                await request(
                    "/providers",
                    `demo1.${Buffer.from(JSON.stringify(expired)).toString("base64url")}`,
                )
            ).status,
        ).toBe(401);
    });
    it("rejects invalid filters and repeated query arguments", async () => {
        const { handle } = setup();
        for (const q of [
            "maxPriceAtomic=-1",
            "model=a&model=b",
            "limit=51",
            "ticket=secret",
        ])
            expect(
                (
                    await handle(
                        new Request(`https://registry.test/providers?${q}`, {
                            headers: { authorization: `Bearer ${token}` },
                        }),
                    )
                ).status,
            ).toBe(400);
    });
    it("uses official MCP client to initialize/list/call through the shared service", async () => {
        const { handle, row } = setup();
        const client = new Client({ name: "registry-test", version: "1.0" });
        const transport = new StreamableHTTPClientTransport(
            new URL("https://registry.test/mcp"),
            {
                requestInit: { headers: { authorization: `Bearer ${token}` } },
                fetch: async (input, init) => handle(new Request(input, init)),
            },
        );
        await client.connect(transport);
        try {
            expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
                ["discover_providers", "get_provider"],
            );
            const result = await client.callTool({
                name: "discover_providers",
                arguments: {},
            });
            expect(result.isError).not.toBe(true);
            expect(JSON.stringify(result)).toContain(row.providerId);
            const provider = await client.callTool({
                name: "get_provider",
                arguments: { providerId: row.providerId },
            });
            expect(provider.isError).not.toBe(true);
        } finally {
            await client.close();
        }
    });
    it("binds cursors to their filter and lifetime", async () => {
        const { service, repo, row } = setup();
        vi.mocked(repo.discover).mockResolvedValue([row, fixtureRecord(now)]);
        const first = await service.discover({ limit: 1 });
        expect(first.nextCursor).not.toBeNull();
        await expect(
            service.discover({
                limit: 1,
                model: "other",
                cursor: first.nextCursor,
            }),
        ).rejects.toThrow("cursor");
    });
    it("does not disclose storage diagnostics through MCP errors", async () => {
        const { handle, repo } = setup();
        vi.mocked(repo.discover).mockRejectedValue(
            new Error("postgres://private-database-password"),
        );
        const response = await handle(
            new Request("https://registry.test/mcp", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/call",
                    params: { name: "discover_providers", arguments: {} },
                }),
            }),
        );
        const text = await response.text();
        expect(text).not.toContain("private-database-password");
        expect(text).toContain("UNAVAILABLE");
    });
});
