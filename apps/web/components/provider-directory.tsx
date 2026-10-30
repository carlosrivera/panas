"use client";
import Link from "next/link";
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

function ProviderStatus({
    provider,
    observation,
    now,
}: {
    provider: PublicProvider;
    observation: Observation;
    now: number;
}) {
    const status = displayedReadiness(provider, observation, now);
    return (
        <span className={`status-pill status-${status.tone}`}>
            <span aria-hidden="true" />
            {status.label}
        </span>
    );
}
function StatIcon({
    name,
}: {
    name: "context" | "output" | "deadline" | "concurrency";
}) {
    const paths = {
        context: (
            <>
                <path d="M4 5h16M4 10h16M4 15h10" />
                <path d="M4 20h8" />
            </>
        ),
        output: (
            <>
                <path d="M5 4h14v16H5z" />
                <path d="M8 8h8M8 12h8M8 16h5" />
            </>
        ),
        deadline: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </>
        ),
        concurrency: (
            <>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1" />
            </>
        ),
    };
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[name]}
        </svg>
    );
}
function ProviderCard({
    provider,
    observation,
    now,
    detail = false,
}: {
    provider: PublicProvider;
    observation: Observation;
    now: number;
    detail?: boolean;
}) {
    return (
        <article
            className={`provider-card-public ${detail ? "provider-detail" : ""}`}
        >
            <div className="provider-card-heading">
                <span className="tiny-label">
                    text inference · provider report
                </span>
                <ProviderStatus
                    provider={provider}
                    observation={observation}
                    now={now}
                />
            </div>
            <h2>
                {detail ? (
                    <>
                        panas <span>{provider.providerId.slice(0, 8)}</span>
                    </>
                ) : (
                    <Link href={`/providers/${provider.providerId}`}>
                        panas {provider.providerId.slice(0, 8)}{" "}
                        <span aria-hidden="true">↗</span>
                    </Link>
                )}
            </h2>
            <p className="provider-model">{provider.model.name}</p>
            <div className="provider-price">
                <strong>
                    {provider.price.totalAtomic === "0"
                        ? "free"
                        : formatCredits(provider.price.totalAtomic)}
                </strong>
                <span>per successful request · test credits</span>
            </div>
            <dl className="provider-facts provider-card-stats">
                <div>
                    <dt>
                        <StatIcon name="context" /> context
                    </dt>
                    <dd>
                        {provider.profile.maxContextTokens.toLocaleString(
                            "en-US",
                        )}
                    </dd>
                </div>
                <div>
                    <dt>
                        <StatIcon name="output" /> output
                    </dt>
                    <dd>{provider.profile.maxOutputTokens}</dd>
                </div>
                <div>
                    <dt>
                        <StatIcon name="deadline" /> deadline
                    </dt>
                    <dd>{provider.profile.timeoutMs / 1000}s</dd>
                </div>
                <div>
                    <dt>
                        <StatIcon name="concurrency" /> concurrency
                    </dt>
                    <dd>{provider.profile.concurrency}</dd>
                </div>
            </dl>
            {detail && (
                <>
                    <dl className="provider-facts provider-revisions">
                        <div>
                            <dt>Pseudonymous identity</dt>
                            <dd className="long-value">
                                {provider.providerId}
                            </dd>
                        </div>
                        <div>
                            <dt>Model digest</dt>
                            <dd className="long-value">
                                {provider.model.digest ?? "Not reported"}
                            </dd>
                        </div>
                        <div>
                            <dt>Ollama revision</dt>
                            <dd>
                                {provider.model.runtimeVersion ??
                                    "Not reported"}
                            </dd>
                        </div>
                        <div>
                            <dt>Price version</dt>
                            <dd className="long-value">
                                {provider.price.version}
                            </dd>
                        </div>
                        <div>
                            <dt>Queue depth</dt>
                            <dd>{provider.profile.queueDepth}</dd>
                        </div>
                    </dl>
                    <div className="benchmark-block">
                        <h3>Provider-reported benchmark</h3>
                        {provider.benchmark ? (
                            <p>
                                {provider.benchmark.warmLatencyMs.toLocaleString(
                                    "en-US",
                                )}{" "}
                                ms warm latency ·{" "}
                                {provider.benchmark.tokensPerSecond.toLocaleString(
                                    "en-US",
                                    { maximumFractionDigits: 2 },
                                )}{" "}
                                output tokens/second
                            </p>
                        ) : (
                            <p>No benchmark reported.</p>
                        )}
                        <p className="small-note">
                            Measured with the capability report on{" "}
                            {formatPublicDate(provider.testedAt)}. This is a
                            provider assertion, not independently verified
                            performance.
                        </p>
                    </div>
                </>
            )}
            <div className="provider-times">
                <p>
                    Checks:{" "}
                    <time dateTime={provider.testedAt}>
                        {formatPublicDate(provider.testedAt)}
                    </time>
                </p>
                <p>
                    Last seen:{" "}
                    <time dateTime={provider.lastSeenAt}>
                        {formatPublicDate(provider.lastSeenAt)}
                    </time>
                </p>
                {detail && (
                    <p>
                        Readiness valid no later than:{" "}
                        <time dateTime={provider.readyUntil}>
                            {formatPublicDate(provider.readyUntil)}
                        </time>
                    </p>
                )}
            </div>
        </article>
    );
}
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
