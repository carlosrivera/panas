import { expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
    DOMAIN,
    verifyDocument,
    signedCloudRequestSchema,
    signDocument,
    type TerminalEvent,
    type Grant,
} from "@panas/protocol";
import { AccountingHttpClient } from "./accounting-client.js";

it(
    "bounds a stalled authorization independently of the live execution signal and never retries it",
    { timeout: 15000 },
    async () => {
        let calls = 0;
        const server = createServer((request) => {
            calls++;
            request.resume();
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address() as { port: number };
        const key = generateKeyPairSync("ed25519");
        const client = new AccountingHttpClient(
            `http://127.0.0.1:${address.port}`,
            randomUUID(),
            key.privateKey,
        );
        const execution = new AbortController();
        try {
            await expect(
                client.authorize(
                    {
                        requestId: randomUUID(),
                        reservationId: randomUUID(),
                        grantId: randomUUID(),
                        payloadDigest: "a".repeat(64),
                    } as Grant,
                    execution.signal,
                ),
            ).rejects.toThrow();
            expect(execution.signal.aborted).toBe(false);
            expect(calls).toBe(1);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    },
);

it("withholds terminal acknowledgement on malformed HTTP200 and accepts coherent idempotent outcomes", async () => {
    const key = generateKeyPairSync("ed25519"),
        providerId = randomUUID();
    const client = new AccountingHttpClient(
        "http://127.0.0.1:12345",
        providerId,
        key.privateKey,
    );
    const payload: TerminalEvent = {
        version: 1,
        eventId: randomUUID(),
        grantId: randomUUID(),
        reservationId: randomUUID(),
        requestId: randomUUID(),
        providerId,
        startupId: randomUUID(),
        outcome: "completed",
        resultDigest: "a".repeat(64),
        completedAt: new Date().toISOString(),
        usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
    };
    const event = signDocument(DOMAIN.terminal, payload, key.privateKey);
    const post = vi.spyOn(client, "post");
    for (const body of [
        null,
        {},
        { requestId: randomUUID(), status: "completed", receipt: {} },
        { requestId: payload.requestId, status: "pending", receipt: null },
        { requestId: payload.requestId, status: "completed", receipt: null },
        {
            requestId: payload.requestId,
            status: "failed",
            receipt: {
                requestId: payload.requestId,
                status: "failed",
                currency: "TEST_CREDIT",
            },
        },
    ]) {
        post.mockResolvedValueOnce(body);
        await expect(client.terminal(event)).rejects.toThrow(
            "NOT_ACKNOWLEDGED",
        );
    }
    for (const status of ["completed", "refunded"]) {
        post.mockResolvedValueOnce({
            requestId: payload.requestId,
            status,
            receipt: {
                requestId: payload.requestId,
                status,
                currency: "TEST_CREDIT",
            },
        });
        await expect(client.terminal(event)).resolves.toBeUndefined();
    }
});
it("binds descriptor acknowledgements to provider and startup", async () => {
    const key = generateKeyPairSync("ed25519"),
        providerId = randomUUID(),
        startupId = randomUUID();
    const client = new AccountingHttpClient(
            "http://127.0.0.1:12345",
            providerId,
            key.privateKey,
        ),
        post = vi.spyOn(client, "post");
    for (const body of [
        {},
        { uploaded: true, providerId: randomUUID(), startupId },
        { uploaded: true, providerId, startupId: randomUUID() },
    ]) {
        post.mockResolvedValueOnce(body);
        await expect(client.descriptor({ startupId })).rejects.toThrow(
            "NOT_ACKNOWLEDGED",
        );
    }
    post.mockResolvedValueOnce({ uploaded: true, providerId, startupId });
    await expect(client.descriptor({ startupId })).resolves.toBeUndefined();
});

it("preserves the accounting mount while signing the backend path", async () => {
    const keys = generateKeyPairSync("ed25519");
    const providerId = randomUUID();
    const client = new AccountingHttpClient(
        "https://panas.mcpwire.co/accounting/",
        providerId,
        keys.privateKey,
    );
    const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
            const request = new Request(input, init);
            expect(request.url).toBe(
                "https://panas.mcpwire.co/accounting/provider/descriptor",
            );
            const signed = signedCloudRequestSchema.parse(
                JSON.parse(
                    Buffer.from(
                        request.headers.get("x-panas-proof")!,
                        "base64url",
                    ).toString(),
                ),
            );
            expect(signed.payload.path).toBe("/provider/descriptor");
            expect(verifyDocument(DOMAIN.cloud, signed, keys.publicKey)).toBe(
                true,
            );
            return Response.json({
                uploaded: true,
                providerId,
                startupId: "fixture",
            });
        });
    try {
        await client.descriptor({ startupId: "fixture" });
    } finally {
        fetcher.mockRestore();
    }
});
