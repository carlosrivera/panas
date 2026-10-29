import { z } from "zod";

export const providerStateSchema = z.enum([
    "offline",
    "testing",
    "ready",
    "busy",
    "draining",
    "paused",
    "unhealthy",
]);
export const atomicAmountSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const requestLimitsSchema = z
    .object({
        maxContextTokens: z.number().int().positive().max(2048),
        maxOutputTokens: z.number().int().positive().max(128),
        timeoutMs: z.number().int().positive().max(60000),
        concurrency: z.literal(1),
        queueDepth: z.number().int().min(0).max(2),
    })
    .strict();
export const prototypeLimits = requestLimitsSchema.parse({
    maxContextTokens: 2048,
    maxOutputTokens: 128,
    timeoutMs: 60000,
    concurrency: 1,
    queueDepth: 2,
});
export const fixedQuoteSchema = z
    .object({
        id: z.uuid(),
        providerId: z.uuid(),
        startupId: z.uuid(),
        buyerKeyId: z.string().min(1),
        modelDigest: z.string().min(1),
        priceVersion: z.string().min(1),
        totalAtomic: atomicAmountSchema,
        currency: z.literal("TEST_CREDIT"),
        limits: requestLimitsSchema,
        expiresAt: z.iso.datetime(),
    })
    .strict();
export const checkResultSchema = z
    .object({ name: z.string(), passed: z.boolean(), detail: z.string() })
    .strict();
export const localReportSchema = z
    .object({
        schemaVersion: z.literal(1),
        startupId: z.uuid(),
        testedAt: z.iso.datetime(),
        state: z.enum(["testing", "unhealthy"]), // Local checks alone must never advertise readiness.
        platform: z.string(),
        architecture: z.string(),
        memoryBytes: z.number().int().nonnegative(),
        model: z.string(),
        checks: z.array(checkResultSchema),
    })
    .strict();
export type LocalReport = z.infer<typeof localReportSchema>;
export type FixedQuote = z.infer<typeof fixedQuoteSchema>;
export type ProviderState = z.infer<typeof providerStateSchema>;

export const inferenceRequestSchema = z
    .object({
        requestId: z.uuid(),
        quoteId: z.uuid(),
        prompt: z.string().min(1).max(8192),
        maxOutputTokens: z.number().int().positive().max(128),
    })
    .strict();
export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;
