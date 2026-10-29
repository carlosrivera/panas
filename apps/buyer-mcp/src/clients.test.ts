import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
    digest,
    DOMAIN,
    verifyDocument,
    signedCloudRequestSchema,
} from "@panas/protocol";
import { createCloudClient } from "./clients";
it("binds HTTP proof to exact actor, method, path, and parsed body without forwarding private prompts", async () => {
    const pair = generateKeyPairSync("ed25519");
    const buyerId = randomUUID();
    let calls = 0;
    const client = createCloudClient({
        url: "https://account.test",
        buyerId,
        privateKey: pair.privateKey,
        fetch: async (input, options) => {
            calls++;
            const request = new Request(input, options);
            const raw = request.headers.get("x-panas-proof")!;
            const signed = signedCloudRequestSchema.parse(
                JSON.parse(Buffer.from(raw, "base64url").toString()),
            );
            expect(verifyDocument(DOMAIN.cloud, signed, pair.publicKey)).toBe(
                true,
            );
            expect(signed.payload.actorId).toBe(buyerId);
            expect(signed.payload.path).toBe(new URL(request.url).pathname);
            expect(signed.payload.method).toBe(request.method);
            const body = request.method === "GET" ? null : await request.json();
            expect(signed.payload.bodyDigest).toBe(digest(body));
            return Response.json({ ok: true });
        },
    });
    await client.quote({
        providerId: randomUUID(),
        requestId: randomUUID(),
        sessionId: randomUUID(),
        payloadDigest: "a".repeat(64),
        maxOutputTokens: 1,
    });
    await client.get(randomUUID());
    expect(calls).toBe(2);
});
it("does not disclose remote diagnostics or infrastructure failures", async () => {
    const pair = generateKeyPairSync("ed25519");
    const options = {
        url: "https://account.test",
        buyerId: randomUUID(),
        privateKey: pair.privateKey,
    };
    const errorClient = createCloudClient({
        ...options,
        fetch: async () =>
            Response.json(
                {
                    error: {
                        code: "UNAVAILABLE",
                        message: "wire://secret postgres://private-token",
                    },
                },
                { status: 503 },
            ),
    });
    await expect(errorClient.get(randomUUID())).rejects.toMatchObject({
        code: "UNAVAILABLE",
        safeMessage: "Cloud service unavailable",
    });
    const failureClient = createCloudClient({
        ...options,
        fetch: async () => {
            throw new Error("private-token");
        },
    });
    await expect(failureClient.get(randomUUID())).rejects.not.toThrow(
        "private-token",
    );
});
