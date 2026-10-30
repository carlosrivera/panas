import Link from "next/link";
import type { ReactNode } from "react";
import { PageIntro } from "./site-shell";
export function GuideLayout({
    audience,
    title,
    description,
    sections,
    quickStart,
    children,
}: {
    audience: string;
    title: string;
    description: string;
    sections: { id: string; label: string }[];
    quickStart?: ReactNode;
    children: ReactNode;
}) {
    return (
        <main id="main" className="shell section">
            <Link href="/providers" className="text-link">
                ← Explore providers
            </Link>
            <PageIntro eyebrow={`${audience} setup`} title={title}>
                <p>{description}</p>
                <span className="guide-availability">
                    Available now · Operator-assisted prototype
                </span>
            </PageIntro>
            {quickStart}
            <div className="guide-layout">
                <aside className="guide-toc">
                    <nav aria-label="On this page">
                        <p className="tiny-label">On this page</p>
                        {sections.map((section, index) => (
                            <a key={section.id} href={`#${section.id}`}>
                                <span aria-hidden="true">0{index + 1}</span>
                                {section.label}
                            </a>
                        ))}
                    </nav>
                    <p>
                        Free or Solana devnet USDC.
                        <br />
                        No real-money pilot.
                    </p>
                </aside>
                <div className="guide-content">{children}</div>
            </div>
        </main>
    );
}
export function GuideSection({
    id,
    number,
    title,
    children,
}: {
    id: string;
    number: string;
    title: string;
    children: ReactNode;
}) {
    return (
        <section id={id} className="guide-section">
            <p className="eyebrow">Step {number}</p>
            <h2>{title}</h2>
            {children}
        </section>
    );
}
export function CodeSample({
    label,
    children,
}: {
    label: string;
    children: string;
}) {
    return (
        <div className="code-sample">
            <p className="code-label">{label}</p>
            <pre tabIndex={0} role="region" aria-label={label}>
                <code>{children}</code>
            </pre>
        </div>
    );
}
export function GuideNotice({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className="guide-notice">
            <h3>{title}</h3>
            <div>{children}</div>
        </div>
    );
}

export function GuideQuickStart({
    command,
    children,
}: {
    command: string;
    children: ReactNode;
}) {
    return (
        <section
            className="guide-quick-start"
            aria-labelledby="quick-start-title"
        >
            <p className="eyebrow">TL;DR</p>
            <h2 id="quick-start-title">Get started.</h2>
            <CodeSample label="Run in your terminal">{command}</CodeSample>
            <p>{children}</p>
        </section>
    );
}
