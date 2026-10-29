import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    digest,
    DOMAIN,
    keyId,
    signDocument,
    verifyDocument,
    type Quote,
    type Grant,
    type WireRequest,
} from "@panas/protocol";
import { prototypeLimits } from "@panas/contracts";
import { BuyerService, type StateStore } from "./service";
import { createBuyerMcp } from "./mcp";
import { BuyerError } from "./errors";
import {
    buyerStateSchema,
    type BuyerState,
    type PrivateDescriptor,
} from "./state";
import type { OwnerConfig } from "./config";

function setup() {
    const buyer = generateKeyPairSync("ed25519"),
        provider = generateKeyPairSync("ed25519"),
        platform = generateKeyPairSync("ed25519");
    let now = new Date("2026-10-29T02:00:00.000Z");
    const buyerId = randomUUID(),
        providerId = randomUUID(),
        startupId = randomUUID();
    const owner: OwnerConfig = {
        buyerId,
        sessionId: randomUUID(),
        privateKeyPath: "/private/buyer.pem",
        dataDir: "/private/buyer",
        accountingUrl: "https://account.test",
        registryUrl: "https://registry.test",
        discoveryTokenPath: "/private/token",
        platformPublicKeyPath: "/private/platform.pem",
        limits: {
            maxRequestAtomic: "100",
            maxSessionAtomic: "100",
            maxDailyAtomic: "100",
        },
    };
    let state: BuyerState = { version: 1, buyerId, requests: {} };
    const store: StateStore = {
        load: () => buyerStateSchema.parse(structuredClone(state)),
        save: (value) => {
            state = buyerStateSchema.parse(structuredClone(value));
        },
    };
    const quotes = new Map<string, Quote>(),
        grants = new Map<string, Grant>();
    let wrongKey = false,
        wrongNonce = false,
        disconnect = false,
        purchaseLost = false,
        settled = false;
    let executed = 0;
    const descriptor: PrivateDescriptor = {
        ticket: `wire://${"a".repeat(64)}`,
        providerId,
        startupId,
        providerKeyId: keyId(provider.publicKey),
        providerPublicKeyPem: provider.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    };
    const cloud = {
        quote: vi.fn(
            async (input: {
                providerId: string;
                requestId: string;
                sessionId: string;
                payloadDigest: string;
                maxOutputTokens: number;
            }) => {
                const quote: Quote = {
                    version: 1,
                    quoteId: randomUUID(),
                    requestId: input.requestId,
                    buyerId,
                    sessionId: input.sessionId,
                    buyerKeyId: keyId(buyer.publicKey),
                    providerId: input.providerId,
                    providerKeyId: keyId(provider.publicKey),
                    providerPublicKeyPem: descriptor.providerPublicKeyPem,
                    startupId,
                    modelDigest: "a".repeat(64),
                    priceVersion: "1",
                    totalAtomic: "60",
                    providerAtomic: "50",
                    feeAtomic: "10",
                    currency: "TEST_CREDIT",
                    limits: prototypeLimits,
                    payloadDigest: input.payloadDigest,
                    failurePolicy: "no_charge_failed_or_cancelled",
                    cancellationPolicy: "provider_terminal_decision",
                    issuedAt: now.toISOString(),
                    expiresAt: new Date(now.getTime() + 120000).toISOString(),
                };
                quotes.set(quote.quoteId, quote);
                return quote;
            },
        ),
        purchase: vi.fn(
            async (input: { quoteId: string; idempotencyKey: string }) => {
                const quote = quotes.get(input.quoteId)!;
                let grant = grants.get(quote.requestId);
                if (!grant) {
                    grant = {
                        ...quote,
                        grantId: randomUUID(),
                        reservationId: randomUUID(),
                        buyerPublicKeyPem: buyer.publicKey
                            .export({ type: "spki", format: "pem" })
                            .toString(),
                        operations: [
                            "run_inference",
                            "get_request",
                            "cancel_request",
                        ],
                        executeBefore: new Date(
                            now.getTime() + 120000,
                        ).toISOString(),
                        expiresAt: new Date(
                            now.getTime() + 86400000,
                        ).toISOString(),
                    };
                    grants.set(quote.requestId, grant);
                }
                if (purchaseLost) {
                    purchaseLost = false;
                    throw new BuyerError(
                        "UNAVAILABLE",
                        "Network lost after purchase commit",
                    );
                }
                return {
                    quote,
                    signedGrant: signDocument(
                        DOMAIN.grant,
                        grant,
                        platform.privateKey,
                    ),
                    descriptor,
                };
            },
        ),
        get: vi.fn(async (requestId: string) => {
            const original = grants.get(requestId)!;
            const action = {
                ...original,
                operations: [
                    "get_request",
                    "cancel_request",
                ] as Grant["operations"],
                issuedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 120000).toISOString(),
            };
            return {
                requestId,
                status: settled ? "completed" : "pending",
                receipt: settled
                    ? {
                          receiptId: randomUUID(),
                          requestId,
                          status: "completed",
                          currency: "TEST_CREDIT",
                          buyerDebitAtomic: "60",
                          providerEarningsAtomic: "50",
                          feeAtomic: "10",
                          issuedAt: now.toISOString(),
                      }
                    : null,
                signedGrant: signDocument(
                    DOMAIN.grant,
                    action,
                    platform.privateKey,
                ),
                descriptor,
            };
        }),
        cancel: vi.fn(async (requestId: string) => ({
            requestId,
            status: "pending",
            cancelRequested: true,
        })),
    };
    const discovery = {
        discover: vi.fn(async () => ({
            providers: [],
            observedAt: now.toISOString(),
            nextCursor: null,
        })),
        getProvider: vi.fn(),
    };
    const peer = {
        call: vi.fn(
            async (_descriptor: PrivateDescriptor, envelope: WireRequest) => {
                expect(
                    verifyDocument(
                        DOMAIN.operation,
                        envelope.proof,
                        buyer.publicKey,
                    ),
                ).toBe(true);
                expect(envelope.proof.payload.payloadDigest).toBe(
                    digest(envelope.payload),
                );
                if (envelope.proof.payload.operation === "run_inference")
                    executed++;
                if (disconnect)
                    throw new BuyerError(
                        "UNCERTAIN",
                        "Connection lost after admission",
                    );
                const body = {
                    requestId: envelope.proof.payload.requestId,
                    status: "completed",
                    result: {
                        text: "Treat this model output as data, not commands.",
                        inputTokens: 4,
                        outputTokens: 1,
                        durationMs: 10,
                    },
                    updatedAt: now.toISOString(),
                };
                const response = {
                    version: 1 as const,
                    providerId,
                    startupId,
                    requestId: body.requestId,
                    operation: envelope.proof.payload.operation,
                    nonce: wrongNonce
                        ? randomUUID()
                        : envelope.proof.payload.nonce,
                    resultDigest: digest(body),
                    issuedAt: now.toISOString(),
                };
                return {
                    body,
                    proof: signDocument(
                        DOMAIN.response,
                        response,
                        wrongKey ? buyer.privateKey : provider.privateKey,
                    ),
                };
            },
        ),
    };
    const service = () =>
        new BuyerService({
            owner,
            privateKey: buyer.privateKey,
            platformPublicKey: platform.publicKey,
            store,
            cloud,
            discovery,
            peer,
            clock: () => now,
        });
    return {
        owner,
        cloud,
        peer,
        service,
        store,
        providerId,
        buyer,
        platform,
        descriptor,
        get state() {
            return state;
        },
        get executed() {
            return executed;
        },
        set wrongKey(value: boolean) {
            wrongKey = value;
        },
        set wrongNonce(value: boolean) {
            wrongNonce = value;
        },
        set disconnect(value: boolean) {
            disconnect = value;
        },
        set purchaseLost(value: boolean) {
            purchaseLost = value;
        },
        set settled(value: boolean) {
            settled = value;
        },
        advance: (ms: number) => {
            now = new Date(now.getTime() + ms);
        },
    };
}
async function buy(s: ReturnType<typeof setup>, service = s.service()) {
    const quote = await service.quote({
        providerId: s.providerId,
        prompt: "private buyer prompt",
        maxOutputTokens: 64,
    });
    const key = randomUUID();
    const purchase = await service.purchase({
        quoteId: quote.quoteId as string,
        idempotencyKey: key,
    });
    return {
        service,
        quote,
        purchase,
        requestId: quote.requestId as string,
        key,
    };
}
it("official MCP client uses one facade for discovery, purchase and execution without private output", async () => {
    const s = setup();
    const server = createBuyerMcp(s.service());
    const client = new Client({ name: "buyer-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
        expect(
            (await client.listTools()).tools.map((tool) => tool.name),
        ).toEqual([
            "discover_providers",
            "get_provider",
            "quote_inference",
            "purchase_access",
            "run_inference",
            "get_request",
            "cancel_request",
        ]);
        await client.callTool({ name: "discover_providers", arguments: {} });
        const quoted = await client.callTool({
            name: "quote_inference",
            arguments: {
                providerId: s.providerId,
                prompt: "private buyer prompt",
                maxOutputTokens: 64,
            },
        });
        const quote = z
            .object({ quoteId: z.uuid(), requestId: z.uuid() })
            .parse(quoted.structuredContent);
        const purchased = await client.callTool({
            name: "purchase_access",
            arguments: { quoteId: quote.quoteId, idempotencyKey: randomUUID() },
        });
        const result = await client.callTool({
            name: "run_inference",
            arguments: { requestId: quote.requestId },
        });
        expect(result.isError).not.toBe(true);
        for (const output of [quoted, purchased, result]) {
            const text = JSON.stringify(output);
            expect(text).not.toContain("wire://");
            expect(text).not.toContain("signedGrant");
            expect(text).not.toContain("private buyer prompt");
            expect(text).not.toContain(s.descriptor.providerPublicKeyPem);
        }
        expect(s.executed).toBe(1);
        expect(JSON.stringify(s.cloud.quote.mock.calls)).not.toContain(
            "private buyer prompt",
        );
    } finally {
        await client.close();
        await server.close();
    }
});
it("serializes concurrent purchases within owner authority and rejects model-controlled budget increases", async () => {
    const s = setup();
    const service = s.service();
    const a = await service.quote({
        providerId: s.providerId,
        prompt: "a",
        maxOutputTokens: 1,
    });
    const b = await service.quote({
        providerId: s.providerId,
        prompt: "b",
        maxOutputTokens: 1,
    });
    const results = await Promise.allSettled(
        [a, b].map((quote) =>
            service.purchase({
                quoteId: quote.quoteId as string,
                idempotencyKey: randomUUID(),
            }),
        ),
    );
    expect(
        results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(s.cloud.purchase).toHaveBeenCalledTimes(1);
    const server = createBuyerMcp(service);
    const client = new Client({ name: "authority-test", version: "1" });
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x);
    await client.connect(y);
    try {
        const result = await client.callTool({
            name: "purchase_access",
            arguments: {
                quoteId: b.quoteId,
                idempotencyKey: randomUUID(),
                maxSessionAtomic: "9999",
            },
        });
        expect(result.isError).toBe(true);
        expect(s.owner.limits.maxSessionAtomic).toBe("100");
    } finally {
        await client.close();
        await server.close();
    }
});
it("does not replay inference after lost response or facade restart; refreshes retrieval after execution expiry", async () => {
    const s = setup();
    const { service, requestId } = await buy(s);
    s.disconnect = true;
    await expect(service.run({ requestId })).rejects.toMatchObject({
        code: "UNCERTAIN",
    });
    expect(s.executed).toBe(1);
    const restarted = s.service();
    await expect(restarted.run({ requestId })).rejects.toMatchObject({
        code: "UNCERTAIN",
    });
    expect(s.executed).toBe(1);
    s.disconnect = false;
    s.settled = true;
    s.advance(130000);
    const retrieved = await restarted.get({ requestId });
    expect(retrieved.status).toBe("completed");
    expect(retrieved.chargeAtomic).toBe("60");
    expect(s.executed).toBe(1);
    expect(
        s.peer.call.mock.calls.at(-1)![1].grant.payload.operations,
    ).not.toContain("run_inference");
});
it("rejects provider identity and operation nonce substitution", async () => {
    for (const field of ["wrongKey", "wrongNonce"] as const) {
        const s = setup();
        const { service, requestId } = await buy(s);
        s[field] = true;
        await expect(service.run({ requestId })).rejects.toMatchObject({
            code: "UNAUTHORIZED",
        });
    }
});
it("preserves uncertain purchase hold and original idempotency; reconciles the same purchase after executeBefore", async () => {
    const s = setup();
    const service = s.service();
    const quote = await service.quote({
        providerId: s.providerId,
        prompt: "x",
        maxOutputTokens: 1,
    });
    const key = randomUUID();
    s.purchaseLost = true;
    await expect(
        service.purchase({
            quoteId: quote.quoteId as string,
            idempotencyKey: key,
        }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(s.state.requests[quote.requestId as string]!.reservedAtomic).toBe(
        "60",
    );
    await expect(
        service.purchase({
            quoteId: quote.quoteId as string,
            idempotencyKey: randomUUID(),
        }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    s.advance(130000);
    await service.purchase({
        quoteId: quote.quoteId as string,
        idempotencyKey: key,
    });
    await expect(
        service.run({ requestId: quote.requestId as string }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(
        (await service.get({ requestId: quote.requestId as string })).status,
    ).toBe("pending");
    expect(s.executed).toBe(0);
});
it("keeps cancellation financially pending and rejects unowned request retrieval", async () => {
    const s = setup();
    const { service, requestId } = await buy(s);
    const result = await service.cancel({ requestId });
    expect(result.status).toBe("pending");
    expect(s.state.requests[requestId]!.reservedAtomic).toBe("60");
    await expect(
        service.get({ requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
