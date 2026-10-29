import {
    createHash,
    createPublicKey,
    sign,
    timingSafeEqual,
    verify,
    type KeyLike,
} from "node:crypto";
import { RegistryError } from "./errors.js";

export interface ProviderKey {
    providerId: string;
    publicKeyPem: string;
    enabled: boolean;
}
export interface RequestProof {
    providerId: string;
    nonce: string;
    timestamp: string;
    signature: string;
}
export function signedMessage(
    method: string,
    path: string,
    rawBody: string,
    timestamp: string,
    nonce: string,
): string {
    return `panas-registry-v1\n${method}\n${path}\n${timestamp}\n${nonce}\n${createHash("sha256").update(rawBody).digest("hex")}`;
}
export function signProviderRequest(
    key: KeyLike,
    providerId: string,
    path: string,
    rawBody: string,
    timestamp: string,
    nonce: string,
): RequestProof {
    return {
        providerId,
        timestamp,
        nonce,
        signature: sign(
            null,
            Buffer.from(signedMessage("POST", path, rawBody, timestamp, nonce)),
            key,
        ).toString("base64url"),
    };
}
export function verifyProviderProof(
    key: ProviderKey | null,
    proof: RequestProof,
    path: string,
    rawBody: string,
    now: Date,
): void {
    const fail = () => {
        throw new RegistryError(
            "UNAUTHORIZED",
            401,
            "Invalid provider authorization",
        );
    };
    if (
        !key?.enabled ||
        key.providerId !== proof.providerId ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            proof.nonce,
        ) ||
        !/^\d{13}$/.test(proof.timestamp) ||
        !/^[a-zA-Z0-9_-]{86}$/.test(proof.signature) ||
        Math.abs(now.getTime() - Number(proof.timestamp)) > 120000
    )
        return fail();
    try {
        const publicKey = createPublicKey(key.publicKeyPem);
        if (
            publicKey.asymmetricKeyType !== "ed25519" ||
            !verify(
                null,
                Buffer.from(
                    signedMessage(
                        "POST",
                        path,
                        rawBody,
                        proof.timestamp,
                        proof.nonce,
                    ),
                ),
                publicKey,
                Buffer.from(proof.signature, "base64url"),
            )
        )
            return fail();
    } catch {
        return fail();
    }
}
export function checkDiscoveryToken(
    authorization: string | null,
    expectedHash: string | undefined,
): void {
    if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash))
        throw new RegistryError(
            "UNAVAILABLE",
            503,
            "Discovery authorization is not configured",
        );
    const supplied = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
    const actual = createHash("sha256").update(supplied).digest();
    if (!supplied || !timingSafeEqual(actual, Buffer.from(expectedHash, "hex")))
        throw new RegistryError(
            "UNAUTHORIZED",
            401,
            "Discovery authorization required",
        );
}
