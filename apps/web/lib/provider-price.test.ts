import { expect, it } from "vitest";
import { prototypeLimits } from "@panas/contracts";
import {
    publicProviderSchema,
    type PublicProvider,
} from "@panas/contracts/public-registry";
import {
    priceLimitToAtomic,
    priceParts,
    comparePrices,
    cheapestPrice,
    type ProviderPrice,
} from "./provider-price";
import { createPublicRead } from "./public-server";

const price = (
    totalAtomic: string,
    currency: ProviderPrice["currency"] = "SOLANA_DEVNET_USDC",
): ProviderPrice => ({ version: "price-v1", totalAtomic, currency });
function provider(p: ProviderPrice): PublicProvider {
    return publicProviderSchema.parse({
        providerId: "11111111-1111-4111-8111-111111111111",
        capability: "text-inference",
        model: { name: "qwen2.5:0.5b", digest: null, runtimeVersion: null },
        profile: prototypeLimits,
        price: p,
        benchmark: null,
        testedAt: "2026-10-29T00:00:00.000Z",
        lastSeenAt: "2026-10-29T00:00:00.000Z",
        expiresAt: "2026-10-29T00:00:45.000Z",
        readyUntil: "2026-10-29T00:00:45.000Z",
        state: "ready",
        readiness: { ready: true, reason: "ready" },
        evidence: { source: "provider-reported", peerProbe: "verified" },
    });
}
it("converts human USDC limits exactly at six decimals and beyond Number precision", () => {
    expect(priceLimitToAtomic("0.01", "SOLANA_DEVNET_USDC")).toBe("10000");
    expect(priceLimitToAtomic("0.000001", "SOLANA_DEVNET_USDC")).toBe("1");
    expect(priceLimitToAtomic("9.123456", "SOLANA_DEVNET_USDC")).toBe(
        "9123456",
    );
    expect(priceLimitToAtomic("9007199254.740993", "SOLANA_DEVNET_USDC")).toBe(
        "9007199254740993",
    );
    expect(priceLimitToAtomic("0", "SOLANA_DEVNET_USDC")).toBe("0");
    expect(priceLimitToAtomic("9007199254740993", "TEST_CREDIT")).toBe(
        "9007199254740993",
    );
});
it("rejects rounding, exponent input, negative limits and amounts outside the API envelope", () => {
    for (const value of [
        "0.0000001",
        "1e3",
        "-1",
        "NaN",
        "01",
        "",
        "1,000",
        "1000000000000000000000000",
    ])
        expect(() => priceLimitToAtomic(value, "SOLANA_DEVNET_USDC")).toThrow();
    expect(() => priceLimitToAtomic("1.0", "TEST_CREDIT")).toThrow();
    expect(() => priceLimitToAtomic("1".repeat(31), "TEST_CREDIT")).toThrow();
});
it("keeps the decimal amount and currency on both compact and detail price displays", () => {
    expect(priceParts(price("10000"))).toEqual({
        amount: "0.01",
        unit: "devnet USDC",
    });
    expect(priceParts(price("1"))).toEqual({
        amount: "0.000001",
        unit: "devnet USDC",
    });
    expect(priceParts(price("9007199254740993"))).toEqual({
        amount: "9,007,199,254.740993",
        unit: "devnet USDC",
    });
    expect(priceParts(price("1", "TEST_CREDIT"))).toEqual({
        amount: "1",
        unit: "test credit",
    });
    expect(priceParts(price("0"))).toEqual({ amount: "free", unit: "" });
});
it("does not declare either paid asset the cheapest without an exchange rate", () => {
    const token = provider(price("10000"));
    const credit = provider(price("1", "TEST_CREDIT"));
    expect(cheapestPrice([token, credit])).toBeNull();
    const free = provider(price("0", "TEST_CREDIT"));
    expect(cheapestPrice([token, credit, free])).toEqual(free.price);
    expect(cheapestPrice([token, provider(price("1"))])).toEqual(price("1"));
    expect(cheapestPrice([])).toBeNull();
});
it("orders free first and compares numeric prices only within the same asset", () => {
    expect(comparePrices(price("0", "TEST_CREDIT"), price("1"))).toBeLessThan(
        0,
    );
    expect(
        comparePrices(price("999999999999999999999"), price("1")),
    ).toBeGreaterThan(0);
    // Cross-asset grouping must not change when nominal atomic magnitudes change.
    expect(
        Math.sign(comparePrices(price("1"), price("1000000", "TEST_CREDIT"))),
    ).toBe(
        Math.sign(comparePrices(price("1000000"), price("1", "TEST_CREDIT"))),
    );
});
it("forwards an entered 0.01 USDC cap to discovery as 10000 atomics with the explicit asset", async () => {
    let seen = false;
    const read = createPublicRead({
        url: "https://registry.test",
        fetch: async (input) => {
            const url = new URL(String(input));
            expect(url.searchParams.get("maxPriceAtomic")).toBe("10000");
            expect(url.searchParams.get("currency")).toBe("SOLANA_DEVNET_USDC");
            seen = true;
            return Response.json({
                providers: [provider(price("10000"))],
                observedAt: "2026-10-29T00:00:00.000Z",
                nextCursor: null,
            });
        },
    });
    const response = await read(
        new URLSearchParams({
            currency: "SOLANA_DEVNET_USDC",
            maxPriceAtomic: priceLimitToAtomic("0.01", "SOLANA_DEVNET_USDC"),
        }),
    );
    expect(response.status).toBe(200);
    expect(seen).toBe(true);
    expect((await response.json()).providers[0].price.currency).toBe(
        "SOLANA_DEVNET_USDC",
    );
});
