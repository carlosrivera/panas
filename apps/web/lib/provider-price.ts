import type { PublicProvider } from "@panas/contracts/public-registry";

export type ProviderPrice = PublicProvider["price"];
export type PriceCurrency = ProviderPrice["currency"];

/** Decimal user input to exact atomic units, without floating-point rounding. */
export function priceLimitToAtomic(
    value: string,
    currency: PriceCurrency,
): string {
    const input = value.trim();
    if (input.length > 37) throw new Error("Price exceeds public amount limit");
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{0,6}))?$/.exec(input);
    if (!match || (currency === "TEST_CREDIT" && match[2] !== undefined))
        throw new Error("Use the selected currency's decimal precision");
    const atomic =
        currency === "SOLANA_DEVNET_USDC"
            ? BigInt(match[1]!) * 1_000_000n +
              BigInt((match[2] ?? "").padEnd(6, "0"))
            : BigInt(match[1]!);
    if (atomic.toString().length > 30)
        throw new Error("Price exceeds public amount limit");
    return atomic.toString();
}

export function priceParts(price: ProviderPrice): {
    amount: string;
    unit: string;
} {
    const value = BigInt(price.totalAtomic);
    if (value === 0n) return { amount: "free", unit: "" };
    if (price.currency === "SOLANA_DEVNET_USDC") {
        const whole = new Intl.NumberFormat("en-US").format(value / 1_000_000n);
        const fraction = (value % 1_000_000n)
            .toString()
            .padStart(6, "0")
            .replace(/0+$/, "");
        return {
            amount: `${whole}${fraction ? "." + fraction : ""}`,
            unit: "devnet USDC",
        };
    }
    return {
        amount: new Intl.NumberFormat("en-US").format(value),
        unit: value === 1n ? "test credit" : "test credits",
    };
}

/** Free first; group different assets, then compare only like-for-like prices. */
export function comparePrices(a: ProviderPrice, b: ProviderPrice): number {
    const aFree = a.totalAtomic === "0",
        bFree = b.totalAtomic === "0";
    if (aFree !== bFree) return aFree ? -1 : 1;
    if (aFree) return 0;
    if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
    const difference = BigInt(a.totalAtomic) - BigInt(b.totalAtomic);
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** No exchange rate is implied when a page contains several paid assets. */
export function cheapestPrice(
    providers: PublicProvider[],
): ProviderPrice | null {
    const prices = providers.map((p) => p.price);
    const free = prices.find((p) => p.totalAtomic === "0");
    if (free) return free;
    if (new Set(prices.map((p) => p.currency)).size > 1) return null;
    return prices.reduce<ProviderPrice | null>(
        (best, price) =>
            !best || comparePrices(price, best) < 0 ? price : best,
        null,
    );
}
