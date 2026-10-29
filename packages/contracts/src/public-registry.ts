import { z } from "zod";
import { providerStateSchema, requestLimitsSchema } from "./index.js";
import { registryPriceSchema, discoveryQuerySchema } from "./registry.js";

/** One TEST_CREDIT atomic unit is one prototype unit. It is not a fiat or on-chain currency. */
export const TEST_CREDIT_SCALE = 0;
export const publicDiscoveryQuerySchema = discoveryQuerySchema.extend({
    readyOnly: z.boolean().default(false),
});
export const publicProviderSchema = z
    .object({
        providerId: z.uuid(),
        capability: z.literal("text-inference"),
        model: z
            .object({
                name: z.literal("qwen2.5:0.5b"),
                digest: z.string().nullable(),
                runtimeVersion: z.string().nullable(),
            })
            .strict(),
        profile: requestLimitsSchema,
        price: registryPriceSchema,
        benchmark: z
            .object({
                warmLatencyMs: z.number().finite().nonnegative(),
                tokensPerSecond: z.number().finite().nonnegative(),
            })
            .strict()
            .nullable(),
        testedAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        readyUntil: z.iso.datetime(),
        state: providerStateSchema,
        readiness: z
            .object({
                ready: z.boolean(),
                reason: z.enum([
                    "ready",
                    "heartbeat_expired",
                    "capability_report_expired",
                    "capability_evidence_unverified",
                    "provider_offline",
                    "provider_testing",
                    "provider_busy",
                    "provider_draining",
                    "provider_paused",
                    "provider_unhealthy",
                ]),
            })
            .strict(),
        evidence: z
            .object({
                source: z.literal("provider-reported"),
                peerProbe: z.enum(["verified", "unverified", "failed"]),
            })
            .strict(),
    })
    .strict()
    .refine(
        (v) => Date.parse(v.readyUntil) <= Date.parse(v.expiresAt),
        "Ready state cannot outlive the heartbeat lease",
    );
export const publicProviderPageSchema = z
    .object({
        providers: z.array(publicProviderSchema).max(50),
        observedAt: z.iso.datetime(),
        nextCursor: z.string().max(1024).nullable(),
    })
    .strict();
export type PublicProvider = z.infer<typeof publicProviderSchema>;
export type PublicProviderPage = z.infer<typeof publicProviderPageSchema>;

export const publicProviderDetailSchema = z
    .object({ provider: publicProviderSchema, observedAt: z.iso.datetime() })
    .strict();
export type PublicProviderDetail = z.infer<typeof publicProviderDetailSchema>;
