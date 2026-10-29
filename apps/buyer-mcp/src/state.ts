import { z } from "zod";
import { atomicAmountSchema } from "@panas/contracts";
import {
    inferencePayloadSchema,
    quoteSchema,
    signedGrantSchema,
    keyId,
    type Quote,
} from "@panas/protocol";
import { validateTicket } from "@panas/mcpwire";
export const descriptorSchema = z
    .object({
        ticket: z.string().refine((value) => {
            try {
                validateTicket(value);
                return true;
            } catch {
                return false;
            }
        }),
        providerId: z.uuid(),
        startupId: z.uuid(),
        providerKeyId: z.string().regex(/^[a-f0-9]{64}$/),
        providerPublicKeyPem: z.string().min(40).max(4096),
        expiresAt: z.iso.datetime(),
    })
    .strict();
export type PrivateDescriptor = z.infer<typeof descriptorSchema>;
export const storedRequestSchema = z
    .object({
        requestId: z.uuid(),
        providerId: z.uuid(),
        sessionId: z.uuid(),
        createdAt: z.iso.datetime(),
        payload: inferencePayloadSchema,
        quote: quoteSchema.nullable(),
        idempotencyKey: z.uuid().nullable(),
        purchaseState: z.enum([
            "draft",
            "quoted",
            "purchasing",
            "purchased",
            "uncertain",
        ]),
        runState: z.enum(["not_sent", "dispatched", "completed", "uncertain"]),
        signedGrant: signedGrantSchema.nullable(),
        descriptor: descriptorSchema.nullable(),
        reservedAtomic: atomicAmountSchema,
        spentAtomic: atomicAmountSchema,
        budgetDay: z.string().nullable(),
    })
    .strict();
export type StoredRequest = z.infer<typeof storedRequestSchema>;
export const buyerStateSchema = z
    .object({
        version: z.literal(1),
        buyerId: z.uuid(),
        requests: z.record(z.uuid(), storedRequestSchema),
    })
    .strict();
export type BuyerState = z.infer<typeof buyerStateSchema>;
export function publicQuote(quote: Quote): Record<string, unknown> {
    return {
        quoteId: quote.quoteId,
        requestId: quote.requestId,
        providerId: quote.providerId,
        modelDigest: quote.modelDigest,
        totalAtomic: quote.totalAtomic,
        providerAtomic: quote.providerAtomic,
        feeAtomic: quote.feeAtomic,
        currency: quote.currency,
        limits: quote.limits,
        expiresAt: quote.expiresAt,
        failurePolicy: quote.failurePolicy,
        cancellationPolicy: quote.cancellationPolicy,
    };
}
export function validateDescriptor(
    value: unknown,
    quote: Quote,
    allowStartupChange = false,
): PrivateDescriptor {
    const descriptor = descriptorSchema.parse(value);
    if (
        descriptor.providerId !== quote.providerId ||
        (!allowStartupChange && descriptor.startupId !== quote.startupId) ||
        descriptor.providerKeyId !== quote.providerKeyId ||
        keyId(descriptor.providerPublicKeyPem) !== quote.providerKeyId
    )
        throw new Error("Private connection identity mismatch");
    return descriptor;
}
