import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prototypeLimits } from "@panas/contracts";
import {
    publicProviderSchema,
    type PublicProvider,
} from "@panas/contracts/public-registry";
import { createPublicRead } from "./public-server";
import {
    anchorObservation,
    displayedReadiness,
    elapsedSinceMs,
    formatAgo,
    formatCredits,
    remainingReadyMs,
} from "./provider-time";
const observedAt = "2026-10-29T03:00:00.000Z";
function fixture(): PublicProvider {
    return publicProviderSchema.parse({
        providerId: randomUUID(),
        capability: "text-inference",
        model: {
            name: "qwen2.5:0.5b",
            digest: "a".repeat(64),
            runtimeVersion: "0.40.12",
        },
        profile: prototypeLimits,
        price: {
            version: "test-fixture",
            totalAtomic: "9007199254740993",
            currency: "TEST_CREDIT",
        },
        benchmark: { warmLatencyMs: 10, tokensPerSecond: 20 },
        testedAt: observedAt,
        lastSeenAt: observedAt,
        expiresAt: "2026-10-29T03:00:45.000Z",
        readyUntil: "2026-10-29T03:00:45.000Z",
        state: "ready",
        readiness: { ready: true, reason: "ready" },
        evidence: { source: "provider-reported", peerProbe: "verified" },
    });
}
it("expires the original ready lease at the 45-second boundary using monotonic elapsed including request time", () => {
    const provider = fixture(),
        observation = { observedAt, startedAt: 1000, trusted: true };
    expect(displayedReadiness(provider, observation, 2000).ready).toBe(true);
    expect(remainingReadyMs(provider, observation, 45000)).toBe(750);
    expect(displayedReadiness(provider, observation, 45750).ready).toBe(false);
    expect(displayedReadiness(provider, observation, 46000).ready).toBe(false);
    expect(
        displayedReadiness(provider, { ...observation, trusted: false }, 2000)
            .label,
    ).toBe("Status unknown");
});
it("never promotes an originally false observation and also respects capability-report expiry", () => {
    const provider = fixture(),
        observation = { observedAt, startedAt: 0, trusted: true };
    expect(
        displayedReadiness(
            {
                ...provider,
                readiness: { ready: false, reason: "provider_testing" },
            },
            observation,
            0,
        ).ready,
    ).toBe(false);
    const nearReportExpiry = {
        ...provider,
        testedAt: "2026-10-28T03:00:01.000Z",
        readyUntil: "2026-10-29T03:00:01.000Z",
    };
    expect(displayedReadiness(nearReportExpiry, observation, 750).ready).toBe(
        false,
    );
});
it("formats integer scale-zero test credits beyond Number precision without rounding", () => {
    expect(formatCredits("9007199254740993")).toBe(
        "9,007,199,254,740,993 test credits",
    );
    expect(formatCredits("1")).toBe("1 test credit");
    expect(formatCredits("0")).toBe("Free");
    expect(formatCredits("0", "SOLANA_DEVNET_USDC")).toBe("Free");
    expect(formatCredits("10000", "SOLANA_DEVNET_USDC")).toBe(
        "0.01 devnet USDC",
    );
    expect(formatCredits("9007199254740993", "SOLANA_DEVNET_USDC")).toBe(
        "9,007,199,254.740993 devnet USDC",
    );
    for (const value of ["1.5", "1e3", "-1", "01"])
        expect(() => formatCredits(value)).toThrow();
});
it.each(["", "/registry", "/registry/"])(
    "the anonymous proxy preserves mount %s and never forwards credentials",
    async (mount) => {
        const provider = fixture();
        const upstream = vi.fn(
            async (input: URL | RequestInfo, init?: RequestInit) => {
                const url = new URL(String(input));
                expect(url.pathname).toBe(
                    `${mount.replace(/\/$/, "")}/public/providers`,
                );
                expect(url.searchParams.get("maxPriceAtomic")).toBe(
                    "9007199254740993",
                );
                expect(init?.cache).toBe("no-store");
                expect(new Headers(init?.headers).has("authorization")).toBe(
                    false,
                );
                return Response.json({
                    providers: [provider],
                    observedAt,
                    nextCursor: null,
                });
            },
        );
        const response = await createPublicRead({
            url: `https://public-registry.test${mount}`,
            fetch: upstream,
        })(new URLSearchParams({ maxPriceAtomic: "9007199254740993" }));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect((await response.json()).providers[0].providerId).toBe(
            provider.providerId,
        );
    },
);
it("rejects private nested fields and malformed responses before sending any payload to the browser", async () => {
    for (const provider of [
        { ...fixture(), ticket: "must-not-escape" },
        {
            ...fixture(),
            model: { ...fixture().model, grant: "must-not-escape" },
        },
    ]) {
        const response = await createPublicRead({
            url: "https://registry.test",
            fetch: async () =>
                Response.json({
                    providers: [provider],
                    observedAt,
                    nextCursor: null,
                }),
        })(new URLSearchParams());
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain("must-not-escape");
    }
});
it("returns safe missing configuration, outage, not-found and invalid filter states", async () => {
    expect((await createPublicRead({})(new URLSearchParams())).status).toBe(
        503,
    );
    const response = await createPublicRead({
        url: "https://registry.test",
        fetch: async () => {
            throw new Error("postgres://private-password");
        },
    })(new URLSearchParams());
    expect(await response.text()).not.toContain("private-password");
    const missing = await createPublicRead({
        url: "https://registry.test",
        fetch: async () => new Response(null, { status: 404 }),
    })(new URLSearchParams(), randomUUID());
    expect(missing.status).toBe(404);
    const upstream = vi.fn();
    const read = createPublicRead({
        url: "https://registry.test",
        fetch: upstream,
    });
    for (const query of [
        "ticket=secret",
        "readyOnly=true&readyOnly=false",
        "maxPriceAtomic=1.5",
        "limit=51",
    ])
        expect((await read(new URLSearchParams(query))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
});

it("preserves a sanitized upstream expired-cursor 400 so the browser can reset pagination", async () => {
    const response = await createPublicRead({
        url: "https://registry.test",
        fetch: async () =>
            Response.json(
                {
                    error: {
                        code: "INVALID_INPUT",
                        message: "private raw cursor diagnostic",
                    },
                },
                { status: 400 },
            ),
    })(new URLSearchParams({ cursor: "opaque-expired-cursor" }));
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("INVALID_FILTERS");
    expect(body).not.toContain("private raw");
});

it("repeated stale responses cannot renew readiness when automatic refresh repeats the same observation", () => {
    const provider = fixture();
    const first = anchorObservation(null, observedAt, 1000);
    const replay = anchorObservation(first, observedAt, 31000);
    expect(replay.startedAt).toBe(1000);
    expect(displayedReadiness(provider, replay, 46000).ready).toBe(false);
    const newer = anchorObservation(first, "2026-10-29T03:00:15.000Z", 16000);
    expect(newer.startedAt).toBe(16000);
});

it("measures seen-ago on the observation clock and formats compact ages", () => {
    const observation = anchorObservation(
        null,
        "2026-01-01T00:01:00.000Z",
        1_000,
    );
    expect(elapsedSinceMs("2026-01-01T00:00:48.000Z", observation, 4_000)).toBe(
        15_000,
    );
    expect(elapsedSinceMs("2026-01-01T00:02:00.000Z", observation, 1_000)).toBe(
        0,
    );
    expect(formatAgo(12_999)).toBe("12s ago");
    expect(formatAgo(41 * 60_000)).toBe("41m ago");
    expect(formatAgo(5 * 3_600_000)).toBe("5h ago");
    expect(formatAgo(3 * 86_400_000)).toBe("3d ago");
});
