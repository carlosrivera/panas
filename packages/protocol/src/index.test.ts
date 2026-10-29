import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
    DOMAIN,
    canonicalJson,
    digest,
    keyId,
    signDocument,
    verifyDocument,
    assertFresh,
    quoteSchema,
} from "./index";
import { prototypeLimits } from "@panas/contracts";
it("canonicalizes nested JSON independent of key insertion order and rejects non-JSON values", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: "é" })).toBe(
        canonicalJson({ a: "é", z: [{ a: 1, b: 2 }] }),
    );
    for (const value of [
        undefined,
        NaN,
        Infinity,
        1n,
        new Date(),
        { x: undefined },
    ])
        expect(() => canonicalJson(value)).toThrow();
    expect(digest({ prompt: "one", maxOutputTokens: 8 })).not.toBe(
        digest({ prompt: "two", maxOutputTokens: 8 }),
    );
});
it("binds signatures to exact payload, key identity, and purpose", () => {
    const first = generateKeyPairSync("ed25519"),
        other = generateKeyPairSync("ed25519");
    const signed = signDocument(
        DOMAIN.operation,
        { a: 1, b: 2 },
        first.privateKey,
    );
    expect(keyId(first.privateKey)).toBe(keyId(first.publicKey));
    expect(
        verifyDocument(
            DOMAIN.operation,
            { ...signed, payload: { b: 2, a: 1 } },
            first.publicKey,
        ),
    ).toBe(true);
    expect(verifyDocument(DOMAIN.cloud, signed, first.publicKey)).toBe(false);
    expect(verifyDocument(DOMAIN.operation, signed, other.publicKey)).toBe(
        false,
    );
    expect(
        verifyDocument(
            DOMAIN.operation,
            { ...signed, payload: { a: 2, b: 2 } },
            first.publicKey,
        ),
    ).toBe(false);
});
it("rejects expired, reversed, too-far-future, and excessively long operation windows", () => {
    const now = Date.now(),
        iso = (n: number) => new Date(n).toISOString();
    assertFresh({ issuedAt: iso(now), expiresAt: iso(now + 60000) }, now);
    for (const [issued, expires] of [
        [now - 1000, now],
        [now + 6000, now + 10000],
        [now, now + 120001],
    ])
        expect(() =>
            assertFresh(
                { issuedAt: iso(issued!), expiresAt: iso(expires!) },
                now,
            ),
        ).toThrow();
});
it("requires fixed charges to reconcile without floating point rounding", () => {
    const pair = generateKeyPairSync("ed25519"),
        now = Date.now();
    const quote = {
        version: 1,
        quoteId: randomUUID(),
        requestId: randomUUID(),
        buyerId: randomUUID(),
        sessionId: randomUUID(),
        buyerKeyId: keyId(pair.publicKey),
        providerId: randomUUID(),
        providerKeyId: keyId(pair.publicKey),
        providerPublicKeyPem: pair.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        startupId: randomUUID(),
        modelDigest: "a".repeat(64),
        priceVersion: "1",
        totalAtomic: "9007199254740993",
        providerAtomic: "9007199254740992",
        feeAtomic: "1",
        currency: "TEST_CREDIT",
        limits: prototypeLimits,
        payloadDigest: "b".repeat(64),
        failurePolicy: "no_charge_failed_or_cancelled",
        cancellationPolicy: "provider_terminal_decision",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
    };
    expect(quoteSchema.safeParse(quote).success).toBe(true);
    expect(quoteSchema.safeParse({ ...quote, feeAtomic: "2" }).success).toBe(
        false,
    );
});
