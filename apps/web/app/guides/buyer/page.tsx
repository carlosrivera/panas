import type { Metadata } from "next";
import { PageIntro } from "../../../components/site-shell";
export const metadata: Metadata = { title: "Buyer setup" };
export default function BuyerGuide() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="Buyer setup"
                title="One connection for your agent."
            >
                <p>
                    The stable local Panas MCP facade handles discovery, fixed
                    quotes, purchases, provider handoff, and receipt retrieval.
                </p>
            </PageIntro>
            <div className="notice-card">
                <h2>Start with the maintained setup instructions.</h2>
                <p>
                    You need a checkout of Panas, Node.js 24, the pinned pnpm
                    version, a local stdio-capable MCP client, and an
                    operator-enrolled test-credit buyer identity. Owners
                    configure keys and spending limits privately.
                </p>
                <a
                    className="text-link"
                    href="https://github.com/carlosrivera/panas/blob/main/apps/buyer-mcp/README.md"
                >
                    Open buyer setup documentation ↗
                </a>
                <p className="small-note">
                    The step-by-step website guide follows in the next frontend
                    slice. Repository access may be required.
                </p>
            </div>
        </main>
    );
}
