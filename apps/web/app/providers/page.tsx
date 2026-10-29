import Link from "next/link";
import type { Metadata } from "next";
import { PageIntro } from "../../components/site-shell";
export const metadata: Metadata = { title: "Provider directory" };
export default function Providers() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="The provider directory"
                title="Find your next connection."
            >
                <p>
                    The public directory is being connected to the registry. No
                    provider inventory is shown here until that safe read
                    integration is available.
                </p>
            </PageIntro>
            <div className="notice-card">
                <h2>Agent discovery is already available.</h2>
                <p>
                    The buyer MCP facade uses authenticated discovery, fixed
                    quotes, and private connection handoff. Browsing this site
                    never reserves capacity or authorizes inference.
                </p>
                <Link className="text-link" href="/guides/buyer">
                    Read buyer setup →
                </Link>
            </div>
        </main>
    );
}
