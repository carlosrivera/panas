import Link from "next/link";
import type { PublicProvider } from "@panas/contracts/public-registry";
import {
    displayedReadiness,
    formatCredits,
    formatPublicDate,
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
export function ProviderCard({
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
