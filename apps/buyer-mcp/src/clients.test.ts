import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
    digest,
    DOMAIN,
    verifyDocument,
    signedCloudRequestSchema,
} from "@panas/protocol";
import {
    createCloudClient,
    createDiscoveryClient,
    safeProvider,
} from "./clients";
import { prototypeLimits } from "@panas/contracts";
it.each([
    "https://account.test",
    "https://account.test/accounting",
    "https://account.test/accounting/",
])("binds HTTP proof to the backend path with base %s", async (base) => {
    const pair = generateKeyPairSync("ed25519");
    const buyerId = randomUUID();
    let calls = 0;
    const client = createCloudClient({
        url: base,
        buyerId,
        privateKey: pair.privateKey,
        fetch: async (input, options) => {
            calls++;
            const request = new Request(input, options);
            expect(request.headers.get("x-panas-peer-addresses")).toBe("1");
            const raw = request.headers.get("x-panas-proof")!;
            const signed = signedCloudRequestSchema.parse(
                JSON.parse(Buffer.from(raw, "base64url").toString()),
            );
            expect(verifyDocument(DOMAIN.cloud, signed, pair.publicKey)).toBe(
                true,
            );
            expect(signed.payload.actorId).toBe(buyerId);
            expect(signed.payload.path).toBe(
                new URL(request.url).pathname.replace(/^\/accounting/, ""),
            );
            expect(request.url).toBe(
                `${base.replace(/\/$/, "")}${signed.payload.path}`,
            );
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

it("returns useful bounded provider information while excluding private connection fields", () => {
    const date = new Date().toISOString();
    const value = {
        peerAddresses: [{ host: "192.168.1.50", port: 52000 }],
        providerId: randomUUID(),
        startupId: randomUUID(),
        model: {
            name: "qwen2.5:0.5b",
            digest: "a".repeat(64),
            runtimeVersion: "0.40.12",
        },
        profile: prototypeLimits,
        price: { version: "1", totalAtomic: "3", currency: "TEST_CREDIT" },
        benchmark: { warmLatencyMs: 10, tokensPerSecond: 20 },
        evidence: { source: "provider-reported", peerProbe: "verified" },
        state: "ready",
        readiness: { ready: true, reason: "ready" },
        testedAt: date,
        lastSeenAt: date,
        expiresAt: date,
        ticket: "private connection material",
        signedGrant: "private authorization",
    };
    const projected = safeProvider(value);
    expect(projected.benchmark).toEqual(value.benchmark);
    expect(projected.price).toEqual(value.price);
    expect(JSON.stringify(projected)).not.toContain(
        "private connection material",
    );
    expect(JSON.stringify(projected)).not.toContain("private authorization");
    expect(JSON.stringify(projected)).not.toContain("192.168.1.50");
});

it("preserves the registry mount and bearer credential for discovery", async () => {
    const id = randomUUID();
    const urls: string[] = [];
    const client = createDiscoveryClient({
        url: "https://panas.mcpwire.co/registry",
        token: "test-discovery-token",
        fetch: async (input, init) => {
            const request = new Request(input, init);
            urls.push(request.url);
            expect(request.headers.get("authorization")).toBe(
                "Bearer test-discovery-token",
            );
            expect(init?.redirect).toBe("error");
            return Response.json({});
        },
    });
    await client.discover({ readyOnly: true, limit: 1 });
    await client.getProvider(id);
    expect(urls).toEqual([
        "https://panas.mcpwire.co/registry/providers?readyOnly=true&limit=1",
        `https://panas.mcpwire.co/registry/providers/${id}`,
    ]);
});

it("retries unavailable quotes and purchases with the same identities and fresh proofs", async () => {
    const pair = generateKeyPairSync("ed25519");
    const bodies: string[] = [],
        nonces: string[] = [];
    let attempts = 0;
    const client = createCloudClient({
        url: "https://account.test",
        buyerId: randomUUID(),
        privateKey: pair.privateKey,
        fetch: async (input, init) => {
            const request = new Request(input, init);
            bodies.push(await request.text());
            nonces.push(
                JSON.parse(
                    Buffer.from(
                        request.headers.get("x-panas-proof")!,
                        "base64url",
                    ).toString(),
                ).payload.nonce,
            );
            attempts++;
            return attempts === 2
                ? Response.json({ ok: true })
                : Response.json(
                      { error: { code: "UNAVAILABLE" } },
                      { status: 503 },
                  );
        },
    });
    await client.quote({
        providerId: randomUUID(),
        requestId: randomUUID(),
        sessionId: randomUUID(),
        payloadDigest: "a".repeat(64),
        maxOutputTokens: 32,
    });
    expect(bodies[0]).toBe(bodies[1]);
    expect(nonces[0]).not.toBe(nonces[1]);
    await expect(
        client.purchase({
            quoteId: randomUUID(),
            idempotencyKey: randomUUID(),
        }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(attempts).toBe(5);
    expect(new Set(bodies.slice(2)).size).toBe(1);
    expect(new Set(nonces.slice(2)).size).toBe(3);
});
