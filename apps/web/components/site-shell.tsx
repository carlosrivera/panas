import Link from "next/link";

export function SiteHeader() {
    return (
        <header>
            <div className="prototype-strip">
                A test-credit prototype. <span>Real Macs, no real money.</span>
            </div>
            <div className="site-header shell">
                <Link href="/" className="wordmark" aria-label="Panas home">
                    panas<span aria-hidden="true">✳</span>
                </Link>
                <nav aria-label="Main navigation" className="main-nav">
                    <Link href="/providers">Providers</Link>
                    <Link href="/guides/buyer">For buyers</Link>
                    <Link href="/guides/provider">For providers</Link>
                </nav>
                <a
                    className="wire-link"
                    href="https://github.com/carlosrivera/mcpwire"
                >
                    Built on MCPWire <span aria-hidden="true">↗</span>
                </a>
            </div>
        </header>
    );
}
export function SiteFooter() {
    return (
        <footer className="site-footer">
            <div className="shell footer-grid">
                <div>
                    <Link href="/" className="wordmark" aria-label="Panas home">
                        panas<span aria-hidden="true">✳</span>
                    </Link>
                    <p>
                        A useful connection
                        <br />
                        for your spare compute.
                    </p>
                </div>
                <nav aria-label="Footer navigation">
                    <Link href="/providers">Provider directory</Link>
                    <Link href="/guides/buyer">Buyer setup</Link>
                    <Link href="/guides/provider">Provider setup</Link>
                    <a href="https://github.com/carlosrivera/mcpwire">
                        MCPWire source ↗
                    </a>
                </nav>
                <p className="footer-note">
                    Made for agent-led discovery.
                    <br />
                    Browsing never reserves capacity
                    <br />
                    or authorizes a purchase.
                </p>
            </div>
            <div className="shell footer-bottom">
                <span>Panas · Share the spare.</span>
                <span>Test credits only · Prototype</span>
            </div>
        </footer>
    );
}
export function PageIntro({
    eyebrow,
    title,
    children,
}: {
    eyebrow: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="page-intro">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <div className="page-lede">{children}</div>
        </div>
    );
}
