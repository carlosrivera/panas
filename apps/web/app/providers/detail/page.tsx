import Link from "next/link";
import { Suspense } from "react";
import { pageMetadata } from "../../../lib/site-metadata";
import { PageIntro } from "../../../components/site-shell";
import { ProviderDetail } from "../../../components/provider-detail";

export const metadata = pageMetadata(
    "Provider details",
    "Explore this provider’s model, limits, price and reported availability on Panas.",
    "/providers/detail/",
);

export default function Provider() {
    return (
        <main id="main" className="shell section">
            <Link href="/providers" className="text-link">
                ← All providers
            </Link>
            <PageIntro
                eyebrow="A reported capability"
                title="Meet this provider."
            >
                <p>
                    Public capability information and observed readiness. Buyer
                    agents obtain their own current quote before authorizing a
                    request.
                </p>
            </PageIntro>
            <Suspense fallback={<p role="status">Loading provider…</p>}>
                <ProviderDetail />
            </Suspense>
        </main>
    );
}
