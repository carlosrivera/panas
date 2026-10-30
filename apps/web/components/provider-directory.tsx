"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    publicProviderPageSchema,
    publicProviderDetailSchema,
    type PublicProviderPage,
} from "@panas/contracts/public-registry";
import {
    anchorObservation,
    displayedReadiness,
    elapsedSinceMs,
    formatAgo,
    formatCredits,
    remainingReadyMs,
    type Observation,
} from "../lib/provider-time";
import {
    cheapestPrice,
    priceLimitToAtomic,
    type PriceCurrency,
} from "../lib/provider-price";
import { Icon } from "./icons";
import { ProviderCard } from "./pana-card";
import { isFixturePreview } from "../lib/preview-mode";

type FilterMode = "all" | "awake" | "free";
const filterModes: { mode: FilterMode; label: string }[] = [
    { mode: "all", label: "all panas" },
    { mode: "awake", label: "awake now" },
    { mode: "free", label: "free only" },
];
export function ProviderDirectory({ providerId }: { providerId?: string }) {
    const [page, setPage] = useState<PublicProviderPage | null>(null);
    const [observation, setObservation] = useState<Observation>({
        observedAt: new Date(0).toISOString(),
        startedAt: 0,
        trusted: false,
    });
    const [now, setNow] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fromFixtures, setFromFixtures] = useState(false);
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<FilterMode>("all");
    const [maxPrice, setMaxPrice] = useState("");
    const [currency, setCurrency] = useState<PriceCurrency | "all">("all");
    const [cursor, setCursor] = useState<string | null>(null);
    const [history, setHistory] = useState<(string | null)[]>([]);
    const request = useRef<AbortController | null>(null);
    const sequence = useRef(0);
    const lastObservation = useRef<Observation | null>(null);
    const load = useCallback(
        async (forceUnknown = false) => {
            request.current?.abort();
            const controller = new AbortController();
            request.current = controller;
            const turn = ++sequence.current;
            const startedAt = performance.now();
            setRefreshing(true);
            if (forceUnknown)
                setObservation((old) => ({ ...old, trusted: false }));
            try {
                if (
                    process.env.NODE_ENV === "development" &&
                    isFixturePreview() &&
                    !providerId
                ) {
                    const { previewProviderPage } =
                        await import("../lib/preview-providers");
                    const parsed =
                        publicProviderPageSchema.parse(previewProviderPage);
                    if (turn !== sequence.current) return;
                    setFromFixtures(true);
                    setPage(parsed);
                    const nextObservation = anchorObservation(
                        lastObservation.current,
                        parsed.observedAt,
                        startedAt,
                    );
                    lastObservation.current = nextObservation;
                    setObservation(nextObservation);
                    setNow(performance.now());
                    setError(null);
                    return;
                }
                const params = new URLSearchParams(query);
                params.set("limit", "12");
                if (cursor) params.set("cursor", cursor);
                const result = await fetch(
                    providerId
                        ? `/api/providers/${providerId}`
                        : `/api/providers?${params}`,
                    {
                        cache: "no-store",
                        credentials: "omit",
                        signal: AbortSignal.any([
                            controller.signal,
                            AbortSignal.timeout(10_000),
                        ]),
                    },
                );
                if (!result.ok) {
                    if (result.status === 404) throw new Error("NOT_FOUND");
                    if (result.status === 400)
                        throw new Error("INVALID_FILTERS");
                    throw new Error("UNAVAILABLE");
                }
                const data: unknown = await result.json();
                let parsed: PublicProviderPage;
                if (providerId) {
                    const detail = publicProviderDetailSchema.parse(data);
                    parsed = {
                        providers: [detail.provider],
                        observedAt: detail.observedAt,
                        nextCursor: null,
                    };
                } else parsed = publicProviderPageSchema.parse(data);
                if (turn !== sequence.current) return;
                setPage(parsed);
                const nextObservation = anchorObservation(
                    lastObservation.current,
                    parsed.observedAt,
                    startedAt,
                );
                lastObservation.current = nextObservation;
                setObservation(nextObservation);
                setNow(performance.now());
                setError(null);
            } catch (error) {
                if (controller.signal.aborted || turn !== sequence.current)
                    return;
                setObservation((old) => ({ ...old, trusted: false }));
                setError(
                    error instanceof Error && error.message === "NOT_FOUND"
                        ? "NOT_FOUND"
                        : error instanceof Error &&
                            error.message === "INVALID_FILTERS"
                          ? "INVALID_FILTERS"
                          : "UNAVAILABLE",
                );
            } finally {
                if (turn === sequence.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [query, cursor, providerId],
    );
    useEffect(() => {
        setLoading(true);
        void load(true);
        return () => {
            request.current?.abort();
            sequence.current++;
        };
    }, [load]);
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(performance.now());
            if (document.visibilityState === "visible") void load();
        }, 15000);
        const revalidate = () => {
            setObservation((old) => ({ ...old, trusted: false }));
            setNow(performance.now());
            if (document.visibilityState === "visible") void load(true);
        };
        document.addEventListener("visibilitychange", revalidate);
        window.addEventListener("focus", revalidate);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", revalidate);
            window.removeEventListener("focus", revalidate);
        };
    }, [load]);
    useEffect(() => {
        if (!page || !observation.trusted) return;
        const remaining = page.providers
            .filter((p) => p.readiness.ready)
            .map((p) => remainingReadyMs(p, observation, performance.now()))
            .filter((v) => v > 0);
        if (!remaining.length) return;
        const timer = setTimeout(
            () => setNow(performance.now()),
            Math.min(...remaining),
        );
        return () => clearTimeout(timer);
    }, [page, observation, now]);
    useEffect(() => {
        const timer = setInterval(() => setNow(performance.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const applyFilters = (
        nextMode: FilterMode,
        nextMax: string,
        nextCurrency = currency,
    ) => {
        const params = new URLSearchParams();
        params.set("readyOnly", String(nextMode === "awake"));
        if (nextCurrency !== "all") params.set("currency", nextCurrency);
        if (nextMode === "free") params.set("maxPriceAtomic", "0");
        else if (nextMax.trim()) {
            try {
                if (nextCurrency === "all")
                    throw new Error("Choose a currency");
                params.set(
                    "maxPriceAtomic",
                    priceLimitToAtomic(nextMax, nextCurrency),
                );
            } catch {
                setError("INVALID_FILTERS");
                return;
            }
        }
        setError(null);
        setHistory([]);
        setCursor(null);
        setQuery(params.toString());
    };
    const hasFilters =
        new URLSearchParams(query).get("readyOnly") === "true" ||
        new URLSearchParams(query).has("maxPriceAtomic") ||
        new URLSearchParams(query).has("currency");
    return (
        <div className="directory-content">
            <p className="sr-only" role="status" aria-atomic="true">
                {!loading && !error && page
                    ? providerId && page.providers[0]
                        ? displayedReadiness(
                              page.providers[0],
                              observation,
                              now,
                          ).label
                        : `${page.providers.filter((provider) => displayedReadiness(provider, observation, now).ready).length} ready as observed out of ${page.providers.length} displayed reports.${observation.trusted ? "" : " Availability is unknown."}`
                    : ""}
            </p>
            {!providerId &&
                page &&
                (() => {
                    const ready = page.providers.filter(
                        (p) => displayedReadiness(p, observation, now).ready,
                    ).length;
                    const cheapest = cheapestPrice(page.providers);
                    return (
                        <section
                            className="directory-summary"
                            aria-label="directory summary"
                        >
                            <div>
                                <span>
                                    <Icon name="mac" /> panas listed
                                </span>
                                <strong>{page.providers.length}</strong>
                            </div>
                            <div>
                                <span>
                                    <span
                                        className="lime-dot"
                                        aria-hidden="true"
                                    />{" "}
                                    awake now
                                </span>
                                <strong className="is-lime">
                                    {observation.trusted ? ready : "—"}
                                </strong>
                            </div>
                            <div>
                                <span>
                                    <Icon name="tag" /> cheapest ask
                                </span>
                                <strong>
                                    {!observation.trusted ||
                                    page.providers.length === 0
                                        ? "—"
                                        : cheapest
                                          ? formatCredits(
                                                cheapest.totalAtomic,
                                                cheapest.currency,
                                            )
                                          : "choose currency"}
                                </strong>
                            </div>
                            <div>
                                <span>
                                    <Icon name="refresh" /> last checked
                                </span>
                                <strong>
                                    {observation.trusted ? (
                                        <time dateTime={page.observedAt}>
                                            {formatAgo(
                                                elapsedSinceMs(
                                                    page.observedAt,
                                                    observation,
                                                    now,
                                                ),
                                            ).replace(" ago", "")}
                                            <small> ago</small>
                                        </time>
                                    ) : (
                                        "—"
                                    )}
                                </strong>
                            </div>
                        </section>
                    );
                })()}
            {!providerId && (
                <div className="directory-filters">
                    <div
                        className="filter-chips"
                        role="group"
                        aria-label="filter panas"
                    >
                        {filterModes.map((item) => (
                            <button
                                key={item.mode}
                                type="button"
                                className="filter-chip"
                                aria-pressed={mode === item.mode}
                                onClick={() => {
                                    setMode(item.mode);
                                    applyFilters(item.mode, maxPrice);
                                }}
                            >
                                {item.mode === "awake" && (
                                    <span
                                        className="lime-dot"
                                        aria-hidden="true"
                                    />
                                )}
                                {item.label}
                            </button>
                        ))}
                        <label className="filter-chip filter-currency">
                            <span className="sr-only">price currency</span>
                            <select
                                aria-label="price currency"
                                value={currency}
                                onChange={(event) => {
                                    const next = event.target.value as
                                        PriceCurrency | "all";
                                    setCurrency(next);
                                    setMaxPrice("");
                                    applyFilters(mode, "", next);
                                }}
                            >
                                <option value="all">all currencies</option>
                                <option value="SOLANA_DEVNET_USDC">
                                    devnet USDC
                                </option>
                                <option value="TEST_CREDIT">
                                    test credits
                                </option>
                            </select>
                        </label>
                        <form
                            className="filter-chip filter-price"
                            onSubmit={(event) => {
                                event.preventDefault();
                                applyFilters(mode, maxPrice);
                            }}
                        >
                            <label htmlFor="max-price">max price</label>
                            <input
                                id="max-price"
                                inputMode={
                                    currency === "SOLANA_DEVNET_USDC"
                                        ? "decimal"
                                        : "numeric"
                                }
                                maxLength={37}
                                autoComplete="off"
                                value={mode === "free" ? "0" : maxPrice}
                                disabled={mode === "free" || currency === "all"}
                                onChange={(event) =>
                                    setMaxPrice(event.target.value)
                                }
                                onBlur={() => applyFilters(mode, maxPrice)}
                                placeholder="any"
                                aria-describedby="price-unit"
                            />
                            <span id="price-unit" className="sr-only">
                                {currency === "SOLANA_DEVNET_USDC"
                                    ? "in devnet USDC, up to six decimal places"
                                    : currency === "TEST_CREDIT"
                                      ? "in whole test credits"
                                      : "choose a currency to set a maximum price"}
                            </span>
                        </form>
                    </div>
                    <button
                        type="button"
                        className="filter-refresh"
                        onClick={() => void load(true)}
                        disabled={refreshing}
                    >
                        <Icon name="refresh" />
                        {refreshing ? "refreshing…" : "refreshes every 15s"}
                        <span className="sr-only"> · refresh now</span>
                    </button>
                </div>
            )}
            {fromFixtures && (
                <p className="small-note fixture-note">
                    development preview · fixtures, not live providers
                </p>
            )}
            {loading && !page && (
                <div className="directory-message" role="status">
                    <h2>checking who’s awake…</h2>
                    <p>status shows up once the registry answers.</p>
                </div>
            )}
            {error && (
                <div
                    className="directory-message message-warning"
                    role="status"
                >
                    <h2>
                        {error === "NOT_FOUND"
                            ? "no pana by that name."
                            : error === "INVALID_FILTERS"
                              ? "those filters need a second look."
                              : "can’t tell who’s awake right now."}
                    </h2>
                    <p>
                        {error === "NOT_FOUND"
                            ? "it’s not in the public registry. the directory has everyone current."
                            : error === "INVALID_FILTERS"
                              ? currency === "SOLANA_DEVNET_USDC"
                                  ? "use a devnet USDC amount with up to six decimal places, or reset the filters."
                                  : "choose a currency and use a valid price; test credits use whole numbers."
                              : "the registry didn’t answer cleanly. anything below is last known, status unknown."}
                    </p>
                    <button
                        className="text-link"
                        onClick={() => {
                            if (error === "INVALID_FILTERS") {
                                setQuery("");
                                setCursor(null);
                                setHistory([]);
                                setMode("all");
                                setMaxPrice("");
                                setCurrency("all");
                            } else void load(true);
                        }}
                    >
                        {error === "INVALID_FILTERS"
                            ? "reset filters"
                            : "try again"}{" "}
                        →
                    </button>
                </div>
            )}
            {!loading && !error && page?.providers.length === 0 && (
                <div className="directory-message" role="status">
                    <h2>
                        {hasFilters
                            ? "no panas match that."
                            : "no panas on the porch yet."}
                    </h2>
                    <p>
                        {hasFilters
                            ? "try all panas or a higher price."
                            : "panas show up after they enroll and pass their checks."}
                    </p>
                    {hasFilters && (
                        <button
                            className="text-link"
                            onClick={() => {
                                setQuery("");
                                setCursor(null);
                                setHistory([]);
                                setMode("all");
                                setMaxPrice("");
                                setCurrency("all");
                            }}
                        >
                            clear filters →
                        </button>
                    )}
                </div>
            )}
            {!!page?.providers.length && (
                <div
                    className={
                        providerId ? "provider-detail-grid" : "provider-grid"
                    }
                >
                    {page.providers.map((provider) => (
                        <ProviderCard
                            key={provider.providerId}
                            provider={provider}
                            observation={observation}
                            now={now}
                            detail={!!providerId}
                        />
                    ))}
                </div>
            )}
            {!providerId && page && (history.length > 0 || page.nextCursor) && (
                <nav className="pagination" aria-label="Provider pages">
                    <button
                        className="text-link"
                        disabled={!history.length || refreshing}
                        onClick={() => {
                            const previous = [...history];
                            const last = previous.pop() ?? null;
                            setHistory(previous);
                            setCursor(last);
                        }}
                    >
                        ← previous
                    </button>
                    <button
                        className="text-link"
                        disabled={!page.nextCursor || refreshing}
                        onClick={() => {
                            setHistory((old) => [...old, cursor]);
                            setCursor(page.nextCursor);
                        }}
                    >
                        next →
                    </button>
                </nav>
            )}
            <p className="directory-disclaimer">
                <Icon name="info" />
                <span>
                    pana-reported, not attested. a listing isn’t a booking.
                    panas can read prompts on their mac; the wire is encrypted.
                    free sharing or solana devnet usdc.
                </span>
            </p>
        </div>
    );
}
