import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
    checkDiscoveryToken,
    signProviderRequest,
    verifyProviderProof,
} from "./auth";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const id = randomUUID();
const key = {
    providerId: id,
    enabled: true,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const now = new Date("2026-10-29T01:00:00Z");
const body = '{"report":"fixture"}';
it("binds provider signature to exact route/body/timestamp and nonce", () => {
    const proof = signProviderRequest(
        privateKey,
        id,
        "/providers/register",
        body,
        String(now.getTime()),
        randomUUID(),
    );
    expect(() =>
        verifyProviderProof(key, proof, "/providers/register", body, now),
    ).not.toThrow();
    expect(() =>
        verifyProviderProof(key, proof, "/providers/heartbeat", body, now),
    ).toThrow();
    expect(() =>
        verifyProviderProof(key, proof, "/providers/register", body + " ", now),
    ).toThrow();
    expect(() =>
        verifyProviderProof(
            key,
            proof,
            "/providers/register",
            body,
            new Date(now.getTime() + 120001),
        ),
    ).toThrow();
    expect(() =>
        verifyProviderProof(
            { ...key, enabled: false },
            proof,
            "/providers/register",
            body,
            now,
        ),
    ).toThrow();
});
it("requires a separate read-only discovery credential and fails closed on missing configuration", () => {
    const hash = createHash("sha256")
        .update("fixture-discovery-secret")
        .digest("hex");
    expect(() =>
        checkDiscoveryToken("Bearer fixture-discovery-secret", hash),
    ).not.toThrow();
    expect(() => checkDiscoveryToken("Bearer wrong", hash)).toThrow("required");
    expect(() => checkDiscoveryToken(null, undefined)).toThrow(
        "not configured",
    );
});
