import { publicProviderPageSchema } from "@panas/contracts/public-registry";

const observedAt = new Date().toISOString();
const testedAt = new Date(Date.now() - 60_000).toISOString();
const heartbeatAt = new Date(Date.now() - 10_000).toISOString();
const leaseAt = (seconds: number) =>
    new Date(Date.now() + seconds * 1000).toISOString();

const entries = [
    ["7f3a9c21", "0", "ready", "ready", 2048, 128, 60],
    ["b28e04d6", "25", "ready", "ready", 2048, 128, 45],
    ["51d0ee7b", "0", "ready", "ready", 1024, 64, 30],
    ["c09f11b2", "40", "ready", "ready", 1536, 96, 60],
    ["e9c47a10", "0", "busy", "provider_busy", 512, 32, 30],
    ["3a71d5e8", "15", "offline", "heartbeat_expired", 2048, 128, 60],
] as const;

export const previewProviderPage = publicProviderPageSchema.parse({
    observedAt,
    nextCursor: null,
    providers: entries.map(
        ([prefix, price, state, reason, context, output, timeout], index) => {
            const providerId = `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
            const ready = reason === "ready";
            return {
                providerId,
                capability: "text-inference",
                model: {
                    name: "qwen2.5:0.5b",
                    digest: null,
                    runtimeVersion: null,
                },
                profile: {
                    maxContextTokens: context,
                    maxOutputTokens: output,
                    timeoutMs: timeout * 1000,
                    concurrency: 1,
                    queueDepth: 2,
                },
                price: {
                    version: "preview-v1",
                    totalAtomic: price,
                    currency: "TEST_CREDIT",
                },
                benchmark: null,
                testedAt,
                lastSeenAt: state === "offline" ? heartbeatAt : observedAt,
                expiresAt: leaseAt(60),
                readyUntil: leaseAt(ready ? Math.min(60, Math.max(1, timeout)) : 1),
                state,
                readiness: { ready, reason },
                evidence: { source: "provider-reported", peerProbe: "verified" },
            };
        },
    ),
});

