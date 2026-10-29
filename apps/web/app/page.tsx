import Link from "next/link";
import { Button } from "@panas/ui/components/ui/button";

const flow = [
    ["Discover", "Your agent finds a suitable provider."],
    ["Quote", "Inspect a fixed price and request bounds."],
    ["Authorize", "Purchase within owner-set limits."],
    ["Connect", "MCPWire opens the peer connection."],
    ["Infer", "The approved model runs on the Mac."],
    ["Receipt", "Retrieve output and the financial outcome."],
];
export default function Home() {
    return (
        <main id="main">
            <section className="hero shell" aria-labelledby="hero-title">
                <div className="hero-copy">
                    <p className="eyebrow">
                        <span className="eyebrow-line" />
                        Compute works better with panas
                    </p>
                    <h1 id="hero-title">
                        Your agent’s
                        <br />
                        next <em>pana.</em>
                    </h1>
                    <p className="hero-lede">
                        Put spare Mac compute to work. Let agents discover a
                        provider, agree on a fixed quote, and make a useful
                        connection.
                    </p>
                    <div className="hero-actions">
                        <Button asChild size="lg">
                            <Link href="/providers">
                                Explore providers{" "}
                                <span aria-hidden="true">↗</span>
                            </Link>
                        </Button>
                        <Link href="/guides/buyer" className="text-link">
                            Connect your agent <span aria-hidden="true">→</span>
                        </Link>
                    </div>
                    <p className="hero-footnote">
                        Agent-led discovery. Encrypted peer connections. Test
                        credits only.
                    </p>
                </div>
                <aside
                    className="connection-card"
                    aria-label="Panas prototype: a local Mac serves inference to a buyer agent"
                >
                    <div className="connection-top">
                        <span className="tiny-label">
                            A little compute.
                            <br />A useful connection.
                        </span>
                        <span className="round-star" aria-hidden="true">
                            ✳
                        </span>
                    </div>
                    <div className="device-illustration" aria-hidden="true">
                        <svg viewBox="0 0 390 230" fill="none">
                            <circle cx="194" cy="110" r="91" fill="#e4e8d3" />
                            <rect
                                x="77"
                                y="45"
                                width="222"
                                height="143"
                                rx="12"
                                fill="#284b3a"
                            />
                            <rect
                                x="87"
                                y="55"
                                width="202"
                                height="121"
                                rx="5"
                                fill="#f8f4e8"
                            />
                            <path
                                d="M56 188h264l-16 17H72l-16-17Z"
                                fill="#41634b"
                            />
                            <path
                                d="M162 188h52l-5 6h-42l-5-6Z"
                                fill="#a6b89e"
                            />
                            <rect
                                x="118"
                                y="79"
                                width="141"
                                height="70"
                                rx="8"
                                fill="#e9eddf"
                            />
                            <path
                                d="m149 101 11 11-11 11m23 0h21"
                                stroke="#284b3a"
                                strokeWidth="5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <circle cx="291" cy="62" r="37" fill="#b33e24" />
                            <path
                                d="M280 62h22m-11-11v22m-8-19 16 16m-16 0 16-16"
                                stroke="#fff9ed"
                                strokeWidth="3"
                                strokeLinecap="round"
                            />
                        </svg>
                    </div>
                    <div className="connection-caption">
                        <span className="tag">Apple Silicon</span>
                        <span className="tag">Native Ollama</span>
                    </div>
                    <div className="connection-bottom">
                        <div>
                            <span className="tiny-label">Starting small</span>
                            <p>qwen2.5:0.5b</p>
                        </div>
                        <span className="prototype-seal">
                            Prototype
                            <br />
                            not a live listing
                        </span>
                    </div>
                </aside>
            </section>
            <section className="belief-band">
                <div className="shell belief-inner">
                    <p>
                        Share a capability.
                        <br />
                        <em>Keep control of your Mac.</em>
                    </p>
                    <div>
                        <span>Fixed, bounded requests</span>
                        <span>Owner-set spending limits</span>
                        <span>Private connection handoff</span>
                    </div>
                </div>
            </section>
            <section className="section shell" aria-labelledby="how-title">
                <div className="section-heading">
                    <div>
                        <p className="eyebrow">How it works</p>
                        <h2 id="how-title">
                            From “who can help?”
                            <br />
                            to a useful result.
                        </h2>
                    </div>
                    <p>
                        One stable MCP facade handles the journey. Your agent
                        can discover and use a provider without visiting this
                        website.
                    </p>
                </div>
                <ol className="flow-grid">
                    {flow.map(([title, detail], index) => (
                        <li key={title}>
                            <span className="step-number">0{index + 1}</span>
                            <h3>{title}</h3>
                            <p>{detail}</p>
                        </li>
                    ))}
                </ol>
            </section>
            <section
                className="section shell audience-section"
                aria-label="Choose your setup guide"
            >
                <article className="audience-card buyer-card">
                    <p className="eyebrow">For the buyer</p>
                    <h2>
                        Give your agent
                        <br />a new connection.
                    </h2>
                    <p>
                        Discover live capabilities, compare bounded quotes, and
                        retrieve results with a receipt. You set the spending
                        authority.
                    </p>
                    <Link href="/guides/buyer" className="text-link">
                        Set up a buyer agent <span aria-hidden="true">→</span>
                    </Link>
                </article>
                <article className="audience-card provider-card">
                    <p className="eyebrow">For the provider</p>
                    <h2>
                        Your Mac.
                        <br />A little more useful.
                    </h2>
                    <p>
                        Run an approved small model natively. Launch checks
                        establish what your Mac can offer before it becomes
                        discoverable.
                    </p>
                    <Link href="/guides/provider" className="text-link">
                        Prepare a provider Mac <span aria-hidden="true">→</span>
                    </Link>
                </article>
            </section>
            <section
                className="section shell trust-section"
                aria-labelledby="trust-title"
            >
                <p className="eyebrow">Clear expectations</p>
                <h2 id="trust-title">
                    A connection built
                    <br />
                    on clear terms.
                </h2>
                <div className="trust-grid">
                    <article>
                        <h3>A fixed quote, within limits.</h3>
                        <p>
                            The prototype charges test credits per successful
                            bounded request. Token counts are diagnostics, not
                            the billing unit. There are no real-money payments.
                        </p>
                    </article>
                    <article>
                        <h3>Encrypted in transit.</h3>
                        <p>
                            MCPWire protects the peer connection. The provider
                            can still inspect workloads on their own Mac; this
                            is not confidential inference.
                        </p>
                    </article>
                    <article>
                        <h3>Claims, with context.</h3>
                        <p>
                            Capability checks and benchmarks are reported by
                            providers. A signed report identifies its source; it
                            does not provide hardware attestation.
                        </p>
                    </article>
                </div>
            </section>
        </main>
    );
}
