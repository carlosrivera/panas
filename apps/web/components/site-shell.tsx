import Link from "next/link";
export function SiteHeader() {
    return (
        <header className="site-header shell">
            <Link href="/" className="wordmark" aria-label="Panas home">
                <span aria-hidden="true">🤝</span> panas
                <span className="wordmark-cursor" aria-hidden="true">
                    _
                </span>
            </Link>
            <nav aria-label="Main navigation" className="main-nav">
                <Link href="/guides/buyer">docs</Link>
                <Link href="/providers">find a pana</Link>
                <a href="https://github.com/carlosrivera/mcpwire">mcpwire ↗</a>
            </nav>
        </header>
    );
}
export function SiteFooter() {
    return (
        <footer className="site-footer shell">
            <div>
                <Link href="/" className="wordmark" aria-label="Panas home">
                    panas
                    <span className="wordmark-cursor" aria-hidden="true">
                        _
                    </span>
                </Link>
                <p>spare compute, between panas.</p>
            </div>
            <nav aria-label="Footer navigation">
                <Link href="/providers">provider directory</Link>
                <Link href="/guides/buyer">buyer setup</Link>
                <Link href="/guides/provider">provider setup</Link>
                <a href="https://github.com/carlosrivera/mcpwire">
                    MCPWire source ↗
                </a>
            </nav>
            <p className="footer-note">
                Browsing never reserves capacity
                <br />
                or authorizes a purchase.
                <br />
                Test-credit prototype. No real money.
            </p>
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
