"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { readPublicRegistry } from "../lib/public-registry-client";
import { comparePrices } from "../lib/provider-price";
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
    const [fromFixtures, setFromFixtures] = useState(false);

    const request = useRef<AbortController | null>(null);
    const sequence = useRef(0);
    const lastObservation = useRef<Observation | null>(null);
    const load = useCallback(async (forceUnknown = false) => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const turn = ++sequence.current;
        if (forceUnknown) setObservation((old) => ({ ...old, trusted: false }));
        const startedAt = performance.now();
        try {
            let parsed: PublicProviderPage;
            if (process.env.NODE_ENV === "development" && isFixturePreview()) {
                const { previewProviderPage } =
                    await import("../lib/preview-providers");
                parsed = publicProviderPageSchema.parse(previewProviderPage);
                setFromFixtures(true);
            } else {
                const response = await readPublicRegistry(
                    new URLSearchParams({ limit: "50" }),
                    undefined,
                    controller.signal,
                );
                if (!response.ok) throw new Error("registry unavailable");
                parsed = publicProviderPageSchema.parse(await response.json());
            }
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
            setError(false);
        } catch {
            if (controller.signal.aborted || turn !== sequence.current) return;
            setObservation((old) => ({ ...old, trusted: false }));
            setError(true);
        } finally {
            if (turn === sequence.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void load();
        }, 15_000);
        const revalidate = () => {
            setObservation((old) => ({ ...old, trusted: false }));
            if (document.visibilityState === "visible") void load(true);
        };
        document.addEventListener("visibilitychange", revalidate);
        window.addEventListener("focus", revalidate);
        return () => {
            request.current?.abort();
            sequence.current++;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", revalidate);
            window.removeEventListener("focus", revalidate);
        };
    }, [load]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(performance.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const providers =
        page?.providers
            .slice()
            .sort((a: PublicProvider, b: PublicProvider) => {
                const aReady = displayedReadiness(a, observation, now).ready;
                const bReady = displayedReadiness(b, observation, now).ready;
                if (aReady !== bReady) return aReady ? -1 : 1;
                return (
                    comparePrices(a.price, b.price) ||
                    a.providerId.localeCompare(b.providerId)
                );
            })
            .slice(0, 3) ?? [];

    return (
        <section className="top-panas" aria-labelledby="top-panas-title">
            <div className="top-panas-heading">
                <div>
                    <h2 id="top-panas-title">
                        panas on <span className="lime">call.</span>
                    </h2>
                    <p>discover a provider. put its compute to work.</p>
                </div>
                <Link className="top-panas-cta" href="/providers">
                    view all panas <span aria-hidden="true">→</span>
                </Link>
            </div>
            {fromFixtures && (
                <p className="top-panas-preview">
                    development preview · fixtures, not live providers
                </p>
            )}
            {loading && !page && (
                <p className="top-panas-message" role="status">
                    checking who’s awake…
                </p>
            )}
            {!loading && error && (
                <p className="top-panas-message" role="status">
                    registry’s taking a nap. try the{" "}
                    <Link href="/providers">full directory</Link>.
                </p>
            )}
            {!loading && !error && providers.length === 0 && (
                <div className="top-panas-message" role="status">
                    <p>no panas listed yet. bring the first one online.</p>
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
