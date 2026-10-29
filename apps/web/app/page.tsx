import { Button } from "@panas/ui/components/ui/button";

const steps = [
    {
        number: "01",
        title: "Find a pana",
        detail: "Your agent discovers available providers and checks the model, tested capabilities, and request limits.",
    },
    {
        number: "02",
        title: "Agree on a price",
        detail: "Accept a fixed quote for a bounded inference request. Your agent works within the spending limits you set.",
    },
    {
        number: "03",
        title: "Connect and compute",
        detail: "MCPWire connects your agent to the provider. Inference runs on their Mac, and you receive a receipt.",
    },
];

export default function Home() {
    return (
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
            <a href="#main" className="skip-link">
                Skip to content
            </a>
            <header className="flex min-h-24 flex-wrap items-center justify-between gap-5 border-b border-border py-5">
                <a
                    href="/"
                    className="text-2xl font-semibold tracking-tight"
                    aria-label="Panas home"
                >
                    panas<span aria-hidden="true"> ↗</span>
                </a>
                <nav
                    aria-label="Main navigation"
                    className="flex items-center gap-6 text-sm"
                >
                    <a
                        className="text-muted-foreground hover:text-foreground"
                        href="#how-it-works"
                    >
                        How it works
                    </a>
                    <a
                        className="text-muted-foreground hover:text-foreground"
                        href="#providers"
                    >
                        For providers
                    </a>
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                        Prototype
                    </span>
                </nav>
            </header>
            <main id="main">
                <section className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[1.35fr_1fr] lg:items-center">
                    <div>
                        <p className="mb-6 font-mono text-xs uppercase tracking-[0.18em] text-primary">
                            Compute works better with panas
                        </p>
                        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-7xl">
                            Spare compute.
                            <br />
                            Meet your next{" "}
                            <span className="text-primary">pana.</span>
                        </h1>
                        <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
                            A network of Macs sharing inference with AI agents.
                            Find a provider, agree on a fixed price, and connect
                            directly through MCPWire.
                        </p>
                        <div className="mt-9 flex flex-wrap items-center gap-4">
                            <Button asChild size="lg">
                                <a href="#how-it-works">
                                    Explore the concept{" "}
                                    <span aria-hidden="true">↗</span>
                                </a>
                            </Button>
                            <a
                                href="https://github.com/carlosrivera/mcpwire"
                                className="text-sm text-muted-foreground underline underline-offset-4"
                            >
                                Built on MCPWire
                            </a>
                        </div>
                    </div>
                    <aside
                        className="rounded-2xl border border-border bg-card p-7 sm:p-9"
                        aria-label="Prototype scope"
                    >
                        <div className="mb-8 flex items-center justify-between gap-4 border-b border-border pb-5">
                            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                                The first connection
                            </p>
                            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                                In development
                            </span>
                        </div>
                        <dl className="space-y-5 text-sm">
                            <div className="flex justify-between gap-6">
                                <dt className="text-muted-foreground">
                                    Provider
                                </dt>
                                <dd className="text-right">
                                    Apple Silicon Mac
                                </dd>
                            </div>
                            <div className="flex justify-between gap-6">
                                <dt className="text-muted-foreground">
                                    Workload
                                </dt>
                                <dd className="text-right">
                                    Small-model text inference
                                </dd>
                            </div>
                            <div className="flex justify-between gap-6">
                                <dt className="text-muted-foreground">
                                    Pricing
                                </dt>
                                <dd className="text-right">
                                    Fixed per bounded request
                                </dd>
                            </div>
                            <div className="flex justify-between gap-6">
                                <dt className="text-muted-foreground">
                                    Connection
                                </dt>
                                <dd className="text-right">
                                    Encrypted peer to peer
                                </dd>
                            </div>
                        </dl>
                        <p className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
                            This is the foundation of Panas. Provider discovery,
                            paid execution, and live availability are being
                            built.
                        </p>
                    </aside>
                </section>
                <section
                    id="how-it-works"
                    className="scroll-mt-10 border-t border-border py-16 sm:py-20"
                    aria-labelledby="how-heading"
                >
                    <p className="font-mono text-xs uppercase tracking-widest text-primary">
                        Made for agents
                    </p>
                    <h2
                        id="how-heading"
                        className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                        From discovery to inference.
                    </h2>
                    <div className="mt-10 grid gap-8 md:grid-cols-3">
                        {steps.map((step) => (
                            <article
                                key={step.number}
                                className="border-t border-border pt-6"
                            >
                                <p className="font-mono text-xs text-primary">
                                    {step.number}
                                </p>
                                <h3 className="mt-4 text-xl font-medium">
                                    {step.title}
                                </h3>
                                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                    {step.detail}
                                </p>
                            </article>
                        ))}
                    </div>
                </section>
                <section
                    id="providers"
                    className="mb-16 scroll-mt-10 rounded-2xl border border-border bg-card p-8 sm:p-12"
                    aria-labelledby="providers-heading"
                >
                    <p className="font-mono text-xs uppercase tracking-widest text-primary">
                        Your device, your limits
                    </p>
                    <h2
                        id="providers-heading"
                        className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                        Let your Mac make a connection.
                    </h2>
                    <p className="mt-5 max-w-2xl leading-relaxed text-muted-foreground">
                        The provider agent will test your Mac’s capabilities at
                        launch, publish what it can run, and enforce bounded
                        requests. You choose when to share and when to pause.
                    </p>
                    <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                        The prototype starts with a small local model and test
                        credits. Buyer agents discover providers through MCP;
                        this site explains the network.
                    </p>
                </section>
            </main>
            <footer className="flex flex-wrap justify-between gap-4 border-t border-border py-8 text-xs text-muted-foreground">
                <p>Panas · Share the spare.</p>
                <a
                    className="underline underline-offset-4"
                    href="https://github.com/carlosrivera/mcpwire"
                >
                    Powered by MCPWire
                </a>
            </footer>
        </div>
    );
}
