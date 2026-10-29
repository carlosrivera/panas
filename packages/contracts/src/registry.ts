import { z } from "zod";
import { atomicAmountSchema, providerStateSchema } from "./index.js";
import { capabilityReportSchema } from "./provider.js";

export const registryPriceSchema = z
    .object({
        version: z.string().min(1).max(80),
        totalAtomic: atomicAmountSchema,
        currency: z.literal("TEST_CREDIT"),
    })
    .strict();
export const registrationSchema = z
    .object({ report: capabilityReportSchema, price: registryPriceSchema })
    .strict();
export const heartbeatSchema = z
    .object({
        providerId: z.uuid(),
        startupId: z.uuid(),
        sequence: z.number().int().nonnegative(),
        reportDigest: z.string().regex(/^[a-f0-9]{64}$/),
        state: providerStateSchema,
    })
    .strict();
export const discoveryQuerySchema = z
    .object({
        model: z.string().min(1).max(100).optional(),
        capability: z.literal("text-inference").optional(),
        minContextTokens: z.number().int().positive().max(2048).optional(),
        minOutputTokens: z.number().int().positive().max(128).optional(),
        maxPriceAtomic: atomicAmountSchema.optional(),
        maxLatencyMs: z.number().nonnegative().max(60000).optional(),
        readyOnly: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().max(1024).optional(),
    })
    .strict();
export type RegistryPrice = z.infer<typeof registryPriceSchema>;
export type Registration = z.infer<typeof registrationSchema>;
export type Heartbeat = z.infer<typeof heartbeatSchema>;
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
