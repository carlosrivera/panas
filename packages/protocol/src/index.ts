import { paymentCurrencySchema } from "@panas/contracts";
import {
    createHash,
    createPrivateKey,
    createPublicKey,
    sign,
    verify,
    type KeyLike,
    KeyObject,
} from "node:crypto";
import { z } from "zod";
import { atomicAmountSchema, requestLimitsSchema } from "@panas/contracts";

export const DOMAIN = {
    grant: "panas.grant.v1",
    operation: "panas.buyer-operation.v1",
    response: "panas.provider-response.v1",
    terminal: "panas.provider-terminal.v1",
    cloud: "panas.cloud-request.v1",
    enrollment: "panas.free-enrollment.v1",
    discovery: "panas.free-discovery.v1",
} as const;
export type SigningDomain = (typeof DOMAIN)[keyof typeof DOMAIN];
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
export const publicKeySchema = z.string().min(40).max(4096);
const date = z.iso.datetime();
export const hostOperationSchema = z.enum([
    "run_inference",
    "get_request",
    "cancel_request",
]);
export type HostOperation = z.infer<typeof hostOperationSchema>;
export function signedSchema<T extends z.ZodType>(payload: T) {
    return z
        .object({ keyId: digestSchema, payload, signature: signatureSchema })
        .strict();
}
export interface SignedDocument<T> {
    keyId: string;
    payload: T;
    signature: string;
}
const quoteObject = z
    .object({
        version: z.literal(1),
        quoteId: z.uuid(),
        requestId: z.uuid(),
        buyerId: z.uuid(),
        sessionId: z.uuid(),
        buyerKeyId: digestSchema,
        providerId: z.uuid(),
        providerKeyId: digestSchema,
        providerPublicKeyPem: publicKeySchema,
        startupId: z.uuid(),
        modelDigest: digestSchema,
        priceVersion: z.string().min(1).max(80),
        totalAtomic: atomicAmountSchema,
        providerAtomic: atomicAmountSchema,
        feeAtomic: atomicAmountSchema,
        currency: paymentCurrencySchema,
        limits: requestLimitsSchema,
        payloadDigest: digestSchema,
        failurePolicy: z.literal("no_charge_failed_or_cancelled"),
        cancellationPolicy: z.literal("provider_terminal_decision"),
        issuedAt: date,
        expiresAt: date,
    })
    .strict();
function checkQuote(value: z.infer<typeof quoteObject>, ctx: z.RefinementCtx) {
    if (
        BigInt(value.totalAtomic) !==
        BigInt(value.providerAtomic) + BigInt(value.feeAtomic)
    )
        ctx.addIssue({
            code: "custom",
            message: "Fixed total must equal provider amount plus fee",
        });
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt))
        ctx.addIssue({
            code: "custom",
            message: "Expiry must follow issuance",
        });
}
export const quoteSchema = quoteObject.superRefine(checkQuote);
export type Quote = z.infer<typeof quoteSchema>;
export const grantSchema = quoteObject
    .extend({
        grantId: z.uuid(),
        reservationId: z.uuid(),
        buyerPublicKeyPem: publicKeySchema,
        operations: z
            .array(hostOperationSchema)
            .min(1)
            .max(3)
            .refine(
                (v) => new Set(v).size === v.length,
                "Duplicate operations",
            ),
        executeBefore: date,
    })
    .superRefine((value, ctx) => {
        checkQuote(value, ctx);
        if (
            value.operations.includes("run_inference") &&
            (Date.parse(value.executeBefore) <= Date.parse(value.issuedAt) ||
                Date.parse(value.executeBefore) > Date.parse(value.expiresAt))
        )
            ctx.addIssue({
                code: "custom",
                message: "Execution deadline must fit grant window",
            });
    });
export type Grant = z.infer<typeof grantSchema>;
export const signedGrantSchema = signedSchema(grantSchema);
export const operationSchema = z
    .object({
        version: z.literal(1),
        grantId: z.uuid(),
        requestId: z.uuid(),
        operation: hostOperationSchema,
        nonce: z.uuid(),
        payloadDigest: digestSchema,
        issuedAt: date,
        expiresAt: date,
    })
    .strict();
export type Operation = z.infer<typeof operationSchema>;
export const signedOperationSchema = signedSchema(operationSchema);
export const wireRequestSchema = z
    .object({
        proof: signedOperationSchema,
        grant: signedGrantSchema,
        payload: z.unknown(),
    })
    .strict();
export type WireRequest = z.infer<typeof wireRequestSchema>;
export const inferencePayloadSchema = z
    .object({
        prompt: z.string().min(1).max(8192),
        maxOutputTokens: z.number().int().positive().max(128),
    })
    .strict();
export const emptyPayloadSchema = z.object({}).strict();
export const providerResponseSchema = z
    .object({
        version: z.literal(1),
        providerId: z.uuid(),
        startupId: z.uuid(),
        requestId: z.uuid(),
        operation: hostOperationSchema,
        nonce: z.uuid(),
        resultDigest: digestSchema,
        issuedAt: date,
    })
    .strict();
export type ProviderResponse = z.infer<typeof providerResponseSchema>;
export const signedProviderResponseSchema = signedSchema(
    providerResponseSchema,
);
export const providerResultSchema = z
    .object({ body: z.unknown(), proof: signedProviderResponseSchema })
    .strict();
export const terminalEventSchema = z
    .object({
        version: z.literal(1),
        eventId: z.uuid(),
        grantId: z.uuid(),
        reservationId: z.uuid(),
        requestId: z.uuid(),
        providerId: z.uuid(),
        startupId: z.uuid(),
        outcome: z.enum(["completed", "cancelled", "failed", "unknown"]),
        resultDigest: digestSchema.nullable(),
        completedAt: date,
        usage: z
            .object({
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
                durationMs: z.number().finite().nonnegative(),
            })
            .strict()
            .nullable(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.outcome === "completed" && value.resultDigest === null)
            ctx.addIssue({
                code: "custom",
                message: "Completed event requires result digest",
            });
    });
export type TerminalEvent = z.infer<typeof terminalEventSchema>;
export const signedTerminalEventSchema = signedSchema(terminalEventSchema);
export const cloudRequestSchema = z
    .object({
        version: z.literal(1),
        actor: z.enum(["buyer", "provider"]),
        actorId: z.uuid(),
        method: z.enum(["GET", "POST"]),
        path: z
            .string()
            .regex(/^\/[A-Za-z0-9_/-]*$/)
            .max(300),
        bodyDigest: digestSchema,
        nonce: z.uuid(),
        issuedAt: date,
        expiresAt: date,
    })
    .strict();
export type CloudRequest = z.infer<typeof cloudRequestSchema>;
export const signedCloudRequestSchema = signedSchema(cloudRequestSchema);

/** Deterministic UTF-16 key order, JSON escaping, finite numbers; no undefined or exotic objects. */
export function canonicalJson(value: unknown): string {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    )
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + Array.from(value, canonicalJson).join(",") + "]";
    if (
        typeof value === "object" &&
        value !== null &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        return (
            "{" +
            Object.keys(value)
                .sort()
                .map(
                    (key) =>
                        JSON.stringify(key) +
                        ":" +
                        canonicalJson((value as Record<string, unknown>)[key]),
                )
                .join(",") +
            "}"
        );
    }
    throw new Error("Signing payload must contain only JSON values");
}
export function digest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function publicObject(key: KeyLike): KeyObject {
    const obj =
        typeof key === "object" && "type" in key && key.type === "public"
            ? (key as KeyObject)
            : createPublicKey(key);
    if (obj.asymmetricKeyType !== "ed25519")
        throw new Error("Only Ed25519 keys are supported");
    return obj;
}
export function keyId(key: KeyLike): string {
    return createHash("sha256")
        .update(publicObject(key).export({ type: "spki", format: "der" }))
        .digest("hex");
}
export function signDocument<T>(
    domain: SigningDomain,
    payload: T,
    privateKey: KeyLike,
): SignedDocument<T> {
    const key =
        privateKey instanceof KeyObject
            ? privateKey
            : createPrivateKey(privateKey);
    if (key.type !== "private")
        throw new Error("Signing requires a private key");
    if (key.asymmetricKeyType !== "ed25519")
        throw new Error("Only Ed25519 keys are supported");
    const message = Buffer.from(domain + "\n" + canonicalJson(payload));
    return {
        keyId: keyId(key),
        payload,
        signature: sign(null, message, key).toString("base64url"),
    };
}
export function verifyDocument<T>(
    domain: SigningDomain,
    document: SignedDocument<T>,
    publicKey: KeyLike,
): boolean {
    try {
        const key = publicObject(publicKey);
        return (
            document.keyId === keyId(key) &&
            signatureSchema.safeParse(document.signature).success &&
            verify(
                null,
                Buffer.from(domain + "\n" + canonicalJson(document.payload)),
                key,
                Buffer.from(document.signature, "base64url"),
            )
        );
    } catch {
        return false;
    }
}
/** Applications must additionally bind actor, target, operation, payload, grant, and durable nonce. */
export function assertFresh(
    window: { issuedAt: string; expiresAt: string },
    now = Date.now(),
    maxLifetimeMs = 120000,
): void {
    const issued = Date.parse(window.issuedAt),
        expires = Date.parse(window.expiresAt);
    if (
        !Number.isFinite(issued) ||
        !Number.isFinite(expires) ||
        issued > now + 5000 ||
        expires <= now ||
        expires <= issued ||
        expires - issued > maxLifetimeMs
    )
        throw new Error("Expired or invalid signed operation window");
}

export const demoEnrollmentSchema = signedSchema(
    z
        .object({
            version: z.literal(1),
            publicKeyPem: publicKeySchema,
            sessionId: z.uuid(),
            issuedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
        })
        .strict(),
);
export const demoDiscoverySchema = signedSchema(
    z
        .object({
            version: z.literal(1),
            scope: z.literal("free-discovery"),
            buyerId: z.uuid(),
            sessionId: z.uuid(),
            issuedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
        })
        .strict(),
);
export const demoEnrollmentResponseSchema = z
    .object({
        buyerId: z.uuid(),
        sessionId: z.uuid(),
        expiresAt: z.iso.datetime(),
        platformPublicKeyPem: publicKeySchema,
        discoveryToken: z.string().min(1).max(8192),
        freeOnly: z.literal(true),
    })
    .strict();
/** Stable key-derived UUIDv8; callers cannot select an existing buyer identity. */
export function demoBuyerId(key: KeyLike): string {
    const hex = keyId(key);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function verifyDemoDiscovery(
    token: string,
    publicKey: KeyLike,
    now = Date.now(),
) {
    if (!token.startsWith("demo1.") || token.length > 8192)
        throw new Error("Invalid discovery token");
    const document = demoDiscoverySchema.parse(
        JSON.parse(Buffer.from(token.slice(6), "base64url").toString("utf8")),
    );
    assertFresh(document.payload, now, 86400000);
    if (!verifyDocument(DOMAIN.discovery, document, publicKey))
        throw new Error("Invalid discovery signature");
    return document.payload;
}
