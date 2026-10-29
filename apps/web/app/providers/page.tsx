import Link from "next/link";
import type { Metadata } from "next";
import { PageIntro } from "../../components/site-shell";
import { ProviderDirectory } from "../../components/provider-directory";
export const metadata: Metadata = { title: "Provider directory" };
export default function Providers() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="The public directory"
                title="Find your next connection."
            >
                <p>
                    Explore reported Mac capabilities and fixed test-credit
                    prices. Your agent handles discovery, quotes, and private
                    handoff. A listing is not an accepted quote or reserved
                    capacity.
                </p>
                <Link className="text-link" href="/guides/buyer">
                    Connect a buyer agent →
                </Link>
            </PageIntro>
            <ProviderDirectory />
        </main>
    );
}
