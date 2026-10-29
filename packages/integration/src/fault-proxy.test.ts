import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:https";
import { startFaultProxy } from "./fault-proxy.js";
import { TEST_ACCOUNTING_URL } from "./config.js";

it("injects isolated TLS faults and restores the original signed request without forwarding other paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "panas-fault-test-"));
    const seen: { url: string; proof: string | null; body: unknown }[] = [];
    const proxy = await startFaultProxy({
        upstream: TEST_ACCOUNTING_URL,
        privateDir: directory,
        port: 0,
        fetch: async (url, init) => {
            seen.push({
                url: String(url),
                proof: new Headers(init?.headers).get("x-panas-proof"),
                body: init?.body,
            });
            return Response.json({ status: "recorded" }, { status: 201 });
        },
    });
    const ca = await readFile(proxy.caPath);
    const send = (path: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = request(
                new URL(path, proxy.url),
                {
                    method: "POST",
                    ca,
                    headers: {
                        "content-type": "application/json",
                        "x-panas-proof": "synthetic-proof",
                        cookie: "must-not-forward",
                    },
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk) =>
                        chunks.push(Buffer.from(chunk)),
                    );
                    response.once("end", () =>
                        resolve({
                            status: response.statusCode!,
                            body: Buffer.concat(chunks).toString(),
                        }),
                    );
                },
            );
            req.once("error", reject);
            req.end('{"quoteId":"synthetic"}');
        });
    try {
        proxy.setFaults({
            newPurchases: true,
            terminal: true,
            authorize: true,
        });
        expect((await send("/quotes")).status).toBe(503);
        expect((await send("/purchases")).status).toBe(503);
        const prefix =
            "/provider/requests/00000000-0000-4000-8000-000000000001";
        expect((await send(`${prefix}/terminal`)).status).toBe(503);
        expect((await send(`${prefix}/authorize`)).status).toBe(503);
        expect((await send("/operator/fund")).status).toBe(404);
        expect((await send("/purchases?redirect=evil")).status).toBe(404);
        expect(seen).toEqual([]);
        proxy.setFaults({
            newPurchases: false,
            terminal: false,
            authorize: false,
        });
        expect((await send("/purchases")).status).toBe(201);
        expect(seen[0]?.url).toBe(`${TEST_ACCOUNTING_URL}/purchases`);
        expect(seen[0]?.proof).toBe("synthetic-proof");
        expect(Buffer.from(seen[0]!.body as Uint8Array).toString()).toBe(
            '{"quoteId":"synthetic"}',
        );
        expect(proxy.snapshot()).toEqual({
            forwarded: 1,
            blockedNewPurchases: 2,
            blockedTerminal: 1,
            blockedAuthorize: 1,
            rejectedPath: 2,
        });
    } finally {
        await proxy.close();
        await rm(directory, { recursive: true, force: true });
    }
}, 20_000);
