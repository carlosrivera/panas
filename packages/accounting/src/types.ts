import { z } from "zod";
import { atomicAmountSchema } from "@panas/contracts";
import {
    digestSchema,
    signedCloudRequestSchema,
    signedTerminalEventSchema,
} from "@panas/protocol";

export const quoteInputSchema = z
    .object({
        providerId: z.uuid(),
        sessionId: z.uuid(),
        requestId: z.uuid(),
        payloadDigest: digestSchema,
        maxOutputTokens: z.number().int().positive().max(128),
    })
    .strict();
export const purchaseInputSchema = z
    .object({ quoteId: z.uuid(), idempotencyKey: z.uuid() })
    .strict();
export const authorizeInputSchema = z
    .object({
        reservationId: z.uuid(),
        grantId: z.uuid(),
        operation: z.literal("run_inference"),
        payloadDigest: digestSchema,
    })
    .strict();
export const terminalInputSchema = z
    .object({ event: signedTerminalEventSchema })
    .strict();
export const descriptorSchema = z
    .object({
        providerId: z.uuid(),
        startupId: z.uuid(),
        providerKeyId: digestSchema,
        providerPublicKeyPem: z.string().min(40).max(4096),
        ticket: z.string().regex(/^wire:\/\/[a-f0-9]{64}$/i),
        expiresAt: z.iso.datetime(),
    })
    .strict();
export const descriptorInputSchema = descriptorSchema.omit({
    providerId: true,
});
export const receiptSchema = z
    .object({
        receiptId: z.uuid(),
        requestId: z.uuid(),
        status: z.enum(["completed", "failed", "cancelled", "refunded"]),
        currency: z.literal("TEST_CREDIT"),
        buyerDebitAtomic: atomicAmountSchema,
        providerEarningsAtomic: atomicAmountSchema,
        feeAtomic: atomicAmountSchema,
        issuedAt: z.iso.datetime(),
        resultDigest: digestSchema.nullable(),
        usage: z
            .object({
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
                durationMs: z.number().nonnegative(),
            })
            .strict()
            .nullable(),
        refundOf: z.uuid().optional(),
    })
    .strict();
export type Receipt = z.infer<typeof receiptSchema>;
export type Descriptor = z.infer<typeof descriptorSchema>;
export type SignedCloudRequest = z.infer<typeof signedCloudRequestSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type RequestStatus =
    | "reserved"
    | "authorized"
    | "pending"
    | "completed"
    | "failed"
    | "cancelled"
    | "refunded";
export type ErrorCode =
    | "INVALID_INPUT"
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "CONFLICT"
    | "REPLAYED_REQUEST"
    | "PROVIDER_UNAVAILABLE"
    | "QUOTE_EXPIRED"
    | "SPENDING_LIMIT"
    | "UNAVAILABLE";
export class AccountingError extends Error {
    constructor(
        readonly code: ErrorCode,
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}
