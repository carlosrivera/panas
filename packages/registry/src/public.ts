import {
    publicProviderSchema,
    publicProviderDetailSchema,
    publicProviderPageSchema,
    type PublicProvider,
    type PublicProviderPage,
} from "@panas/contracts/public-registry";
import { REPORT_TTL_MS } from "./model.js";
import { queryFromUrl } from "./service.js";

function object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Invalid public projection");
    return input as Record<string, unknown>;
}
/** Explicit nested allowlist: internal additions must never become public implicitly. */
export function toPublicProvider(
    input: unknown,
    observedAt: string,
): PublicProvider {
    const row = object(input),
        model = object(row.model),
        profile = object(row.profile),
        price = object(row.price),
        ready = object(row.readiness),
        evidence = object(row.evidence);
    const benchmark = row.benchmark === null ? null : object(row.benchmark);
    const tested = Date.parse(String(row.testedAt)),
        expires = Date.parse(String(row.expiresAt)),
        now = Date.parse(observedAt);
    const readyUntil = Math.min(expires, tested + REPORT_TTL_MS);
    return publicProviderSchema.parse({
        providerId: row.providerId,
        capability: row.capability,
        model: {
            name: model.name,
            digest: model.digest,
            runtimeVersion: model.runtimeVersion,
        },
        profile: {
            maxContextTokens: profile.maxContextTokens,
            maxOutputTokens: profile.maxOutputTokens,
            timeoutMs: profile.timeoutMs,
            concurrency: profile.concurrency,
            queueDepth: profile.queueDepth,
        },
        price: {
            version: price.version,
            totalAtomic: price.totalAtomic,
            currency: price.currency,
        },
        benchmark:
            benchmark === null
                ? null
                : {
                      warmLatencyMs: benchmark.warmLatencyMs,
                      tokensPerSecond: benchmark.tokensPerSecond,
                  },
        testedAt: row.testedAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
        readyUntil: new Date(readyUntil).toISOString(),
        state: row.state,
        readiness:
            ready.ready === true && readyUntil <= now
                ? {
                      ready: false,
                      reason:
                          expires <= now
                              ? "heartbeat_expired"
                              : "capability_report_expired",
                  }
                : { ready: ready.ready, reason: ready.reason },
        evidence: { source: evidence.source, peerProbe: evidence.peerProbe },
    });
}
export function toPublicPage(input: unknown): PublicProviderPage {
    const row = object(input);
    if (typeof row.observedAt !== "string" || !Array.isArray(row.providers))
        throw new Error("Invalid public page");
    return publicProviderPageSchema.parse({
        providers: row.providers.map((p) =>
            toPublicProvider(p, row.observedAt as string),
        ),
        observedAt: row.observedAt,
        nextCursor: row.nextCursor,
    });
}
export function publicQueryFromUrl(input: URL) {
    const url = new URL(input);
    if (!url.searchParams.has("readyOnly"))
        url.searchParams.set("readyOnly", "false");
    return queryFromUrl(url);
}

export function toPublicDetail(input: unknown, observedAt: string) {
    return publicProviderDetailSchema.parse({
        provider: toPublicProvider(input, observedAt),
        observedAt,
    });
}
