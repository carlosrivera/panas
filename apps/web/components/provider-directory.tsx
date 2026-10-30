"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    publicProviderPageSchema,
    publicProviderDetailSchema,
    type PublicProvider,
    type PublicProviderPage,
} from "@panas/contracts/public-registry";
import {
    anchorObservation,
    displayedReadiness,
    formatCredits,
    formatPublicDate,
    remainingReadyMs,
    type Observation,
} from "../lib/provider-time";
import { ProviderCard } from "./pana-card";
import { isFixturePreview } from "../lib/preview-mode";

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
    const [query, setQuery] = useState("");
    const [readyFilter, setReadyFilter] = useState("false");
    const [maxPrice, setMaxPrice] = useState("");
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
                if (isFixturePreview() && !providerId) {
                    const { previewProviderPage } = await import("../lib/preview-providers");
                    const parsed = publicProviderPageSchema.parse(previewProviderPage);
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
    const hasFilters =
        new URLSearchParams(query).get("readyOnly") === "true" ||
        new URLSearchParams(query).has("maxPriceAtomic");
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
            {!providerId && (
                <form
                    className="directory-filters"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const params = new URLSearchParams();
                        params.set("readyOnly", readyFilter);
                        if (maxPrice) params.set("maxPriceAtomic", maxPrice);
                        setHistory([]);
                        setCursor(null);
                        setQuery(params.toString());
                    }}
                >
                    <label>
                        Readiness
                        <select
                            value={readyFilter}
                            onChange={(event) =>
                                setReadyFilter(event.target.value)
                            }
                        >
                            <option value="false">
                                All reported providers
                            </option>
                            <option value="true">Ready as observed</option>
                        </select>
                    </label>
                    <label>
                        Maximum price{" "}
                        <span className="small-note">(test credits)</span>
                        <input
                            inputMode="numeric"
                            autoComplete="off"
                            value={maxPrice}
                            onChange={(event) =>
                                setMaxPrice(event.target.value)
                            }
                            placeholder="No maximum"
                            aria-describedby="credit-unit"
                        />
                    </label>
                    <button type="submit" className="filter-button">
                        Apply filters
                    </button>
                    <p id="credit-unit" className="filter-note">
                        One integer unit is one test credit. No real money.
                    </p>
                </form>
            )}
            {isFixturePreview() && !providerId && (
                <p className="small-note">development preview · fixtures, not live providers</p>
            )}
            <div className="directory-toolbar">
                <p className="small-note">
                    {page ? (
                        <>
                            Observed{" "}
                            <time dateTime={page.observedAt}>
                                {formatPublicDate(page.observedAt)}
                            </time>{" "}
                            · refreshes every 15 seconds
                        </>
                    ) : (
                        "Public provider data · no sign-in required"
                    )}
                </p>
                <button
                    className="text-link"
                    onClick={() => void load(true)}
                    disabled={refreshing}
                >
                    {refreshing ? "Refreshing…" : "Refresh"}
                    <span aria-hidden="true">↻</span>
                </button>
            </div>
            {!providerId &&
                page &&
                (() => {
                    const ready = page.providers.filter(
                        (p) => displayedReadiness(p, observation, now).ready,
                    ).length;
                    const cheapest =
                        page.providers.reduce<PublicProvider | null>(
                            (best, item) =>
                                !best ||
                                BigInt(item.price.totalAtomic) <
                                    BigInt(best.price.totalAtomic)
                                    ? item
                                    : best,
                            null,
                        );
                    return (
                        <section
                            className="directory-summary"
                            aria-label="Directory summary"
                        >
                            <div>
                                <span>panas listed</span>
                                <strong>{page.providers.length}</strong>
                                <small>this page</small>
                            </div>
                            <div>
                                <span>ready now</span>
                                <strong>
                                    {observation.trusted ? ready : "—"}
                                </strong>
                                <small>
                                    {observation.trusted
                                        ? "as observed"
                                        : "status unknown"}
                                </small>
                            </div>
                            <div>
                                <span>cheapest request</span>
                                <strong>
                                    {cheapest
                                        ? cheapest.price.totalAtomic === "0"
                                            ? "free"
                                            : formatCredits(
                                                  cheapest.price.totalAtomic,
                                              )
                                        : "—"}
                                </strong>
                                <small>on this page</small>
                            </div>
                        </section>
                    );
                })()}
            {loading && !page && (
                <div className="directory-message" role="status">
                    <span className="tiny-label">
                        Checking the public registry
                    </span>
                    <h2>Finding the latest reports.</h2>
                    <p>
                        Readiness is shown only after a valid public response.
                    </p>
                </div>
            )}
            {error && (
                <div
                    className="directory-message message-warning"
                    role="status"
                >
                    <h2>
                        {error === "NOT_FOUND"
                            ? "Provider not found."
                            : error === "INVALID_FILTERS"
                              ? "These filters need a second look."
                              : "We can’t verify availability right now."}
                    </h2>
                    <p>
                        {error === "NOT_FOUND"
                            ? "This identifier is not in the public registry. Return to the directory for current entries."
                            : error === "INVALID_FILTERS"
                              ? "Use a nonnegative integer price, or reset an expired page cursor."
                              : "The registry did not return valid current data. Any previous reports below are last-known information with status unknown."}
                    </p>
                    <button
                        className="text-link"
                        onClick={() => {
                            if (error === "INVALID_FILTERS") {
                                setQuery("");
                                setCursor(null);
                                setHistory([]);
                                setReadyFilter("false");
                                setMaxPrice("");
                            } else void load(true);
                        }}
                    >
                        {error === "INVALID_FILTERS"
                            ? "Reset filters and pagination"
                            : "Try again"}{" "}
                        →
                    </button>
                </div>
            )}
            {!loading && !error && page?.providers.length === 0 && (
                <div className="directory-message" role="status">
                    <span className="tiny-label">The public registry</span>
                    <h2>
                        {hasFilters
                            ? "No providers match these filters."
                            : "no panas on the porch yet."}
                    </h2>
                    <p>
                        {hasFilters
                            ? "Try all reported providers or a higher price ceiling. A result is still only an observation, not reserved capacity."
                            : "Providers appear after enrollment and capability reporting. Buyer agents can check the registry again later."}
                    </p>
                    {hasFilters && (
                        <button
                            className="text-link"
                            onClick={() => {
                                setQuery("");
                                setCursor(null);
                                setHistory([]);
                                setReadyFilter("false");
                                setMaxPrice("");
                            }}
                        >
                            Clear filters →
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
                        ← Previous page
                    </button>
                    <button
                        className="text-link"
                        disabled={!page.nextCursor || refreshing}
                        onClick={() => {
                            setHistory((old) => [...old, cursor]);
                            setCursor(page.nextCursor);
                        }}
                    >
                        Next page →
                    </button>
                </nav>
            )}
            <p className="directory-disclaimer">
                a listing isn’t a quote or reservation; browsing doesn’t reserve
                capacity. provider claims aren’t hardware attestation. test
                credits only, no real money. providers can read prompts on their
                Mac; connections are encrypted in transit.
            </p>
        </div>
    );
}
