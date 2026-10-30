"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
    publicProviderPageSchema,
    type PublicProvider,
    type PublicProviderPage,
} from "@panas/contracts/public-registry";
import {
    anchorObservation,
    displayedReadiness,
    type Observation,
} from "../lib/provider-time";
import { isFixturePreview } from "../lib/preview-mode";
import { ProviderCard } from "./pana-card";
import "../app/top-panas.css";

export function TopPanas() {
    const [page, setPage] = useState<PublicProviderPage | null>(null);
    const [observation, setObservation] = useState<Observation>({
        observedAt: new Date(0).toISOString(),
        startedAt: 0,
        trusted: false,
    });
    const [now, setNow] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
        const startedAt = performance.now();
        try {
            let parsed: PublicProviderPage;
            if (isFixturePreview()) {
                const { previewProviderPage } = await import("../lib/preview-providers");
                parsed = publicProviderPageSchema.parse(previewProviderPage);
            } else {
                const response = await fetch("/api/providers?limit=50", {
                    cache: "no-store",
                    credentials: "omit",
                    signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) throw new Error("registry unavailable");
                parsed = publicProviderPageSchema.parse(await response.json());
            }
            setPage(parsed);
            setObservation((previous) =>
                anchorObservation(previous.trusted ? previous : null, parsed.observedAt, startedAt),
            );
            setNow(performance.now());
            setError(false);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void load();
        }, 15_000);
        const revalidate = () => {
            if (document.visibilityState === "visible") void load();
        };
        document.addEventListener("visibilitychange", revalidate);
        window.addEventListener("focus", revalidate);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", revalidate);
            window.removeEventListener("focus", revalidate);
        };
    }, [load]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(performance.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const providers = page?.providers
        .slice()
        .sort((a: PublicProvider, b: PublicProvider) => {
            const aReady = displayedReadiness(a, observation, now).ready;
            const bReady = displayedReadiness(b, observation, now).ready;
            if (aReady !== bReady) return aReady ? -1 : 1;
            const priceOrder = BigInt(a.price.totalAtomic) - BigInt(b.price.totalAtomic);
            return priceOrder < 0n ? -1 : priceOrder > 0n ? 1 : 0;
        })
        .slice(0, 3) ?? [];

    return (
        <section className="top-panas" aria-labelledby="top-panas-title">
            <div className="top-panas-heading">
                <div>
                    <h2 id="top-panas-title">
                        panas on <span className="lime">call.</span>
                    </h2>
                    <p>free friends first. awake as last observed.</p>
                </div>
                <Link className="text-link" href="/providers">
                    view all panas →
                </Link>
            </div>
            {isFixturePreview() && (
                <p className="top-panas-preview">development preview · fixtures, not live providers</p>
            )}
            {loading && !page && <p className="top-panas-message" role="status">checking who’s awake…</p>}
            {!loading && error && <p className="top-panas-message" role="status">registry’s taking a nap. try the <Link href="/providers">full directory</Link>.</p>}
            {!loading && !error && providers.length === 0 && (
                <div className="top-panas-message" role="status">
                    <p>no panas awake yet. all good, naps are important.</p>
                    <Link href="/guides/provider">wake your mac →</Link>
                </div>
            )}
            {providers.length > 0 && (
                <div className="top-panas-grid">
                    {providers.map((provider) => (
                        <ProviderCard
                            key={provider.providerId}
                            provider={provider}
                            observation={observation}
                            now={now}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
