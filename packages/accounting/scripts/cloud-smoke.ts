import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { DOMAIN, digest, signDocument } from "@panas/protocol";
import { AccountingService } from "../src/service.js";
const endpoint =
    process.env.PANAS_ACCOUNTING_URL ??
    "https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run/";
const connectionString = process.env.PANAS_REGISTRY_DATABASE_URL;
if (!connectionString)
    throw new Error("Load private operator database environment");
const keys = generateKeyPairSync("ed25519"),
    platform = generateKeyPairSync("ed25519"),
    buyerId = randomUUID(),
    sessionId = randomUUID();
const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
});
const service = new AccountingService(pool, {
    platformPrivateKey: platform.privateKey,
    descriptorEncryptionKey: randomBytes(32),
});
async function call(
    path: string,
    body: unknown,
    method: "GET" | "POST" = "POST",
) {
    const now = Date.now(),
        proof = signDocument(
            DOMAIN.cloud,
            {
                version: 1 as const,
                actor: "buyer" as const,
                actorId: buyerId,
                method,
                path,
                bodyDigest: digest(body),
                nonce: randomUUID(),
                issuedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + 120000).toISOString(),
            },
            keys.privateKey,
        );
    return fetch(new URL(path, endpoint), {
        method,
        headers: {
            "content-type": "application/json",
            "x-panas-proof": Buffer.from(JSON.stringify(proof)).toString(
                "base64url",
            ),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
    });
}
try {
    await service.operatorEnrollBuyer({
        buyerId,
        publicKeyPem: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
        maxRequestAtomic: "1",
        maxSessionAtomic: "1",
        maxDailyAtomic: "1",
        policyVersion: "cloud-smoke-no-funding",
    });
    await service.operatorOpenSession({
        buyerId,
        sessionId,
        capAtomic: "1",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
    });
    const unauthorized = await fetch(
        new URL(`/requests/${randomUUID()}`, endpoint),
    );
    if (unauthorized.status !== 401)
        throw new Error(`Expected401, got${unauthorized.status}`);
    const quote = await call("/quotes", {
        providerId: process.env.PANAS_SMOKE_PROVIDER_ID ?? randomUUID(),
        sessionId,
        requestId: randomUUID(),
        payloadDigest: "a".repeat(64),
        maxOutputTokens: 16,
    });
    if (process.env.PANAS_SMOKE_PROVIDER_ID) {
        if (quote.status !== 200)
            throw new Error(`Live-provider quote failed${quote.status}`);
    } else {
        const result = (await quote.json()) as { error?: { code?: string } };
        if (
            quote.status !== 409 ||
            result.error?.code !== "PROVIDER_UNAVAILABLE"
        )
            throw new Error(`Unavailable-provider guard failed${quote.status}`);
    }
    const owner = await call("/owner/fund", { amountAtomic: "999999" });
    if (owner.status !== 404)
        throw new Error(`Unexpected owner route${owner.status}`);
    const absent = await call(`/requests/${randomUUID()}`, null, "GET");
    if (absent.status !== 404)
        throw new Error(`Expected owned-request404, got${absent.status}`);
    console.log(
        "Verified cloud accounting401, signed buyer authentication, quote provider guard, no agent funding route, and request404. No credits minted or reserved.",
    );
} finally {
    await pool.query("DELETE FROM panas_accounting_quotes WHERE buyer_id=$1", [
        buyerId,
    ]);
    await pool.query(
        "DELETE FROM panas_accounting_nonces WHERE actor='buyer' AND actor_id=$1",
        [buyerId],
    );
    await pool.query(
        "DELETE FROM panas_accounting_sessions WHERE buyer_id=$1",
        [buyerId],
    );
    await pool.query("DELETE FROM panas_accounting_buyers WHERE buyer_id=$1", [
        buyerId,
    ]);
    await pool.end();
}
