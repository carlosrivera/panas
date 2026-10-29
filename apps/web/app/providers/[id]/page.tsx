import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageIntro } from "../../../components/site-shell";
import { ProviderDirectory } from "../../../components/provider-directory";
export const metadata: Metadata = { title: "Provider details" };
export default async function Provider({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) notFound();
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
            <ProviderDirectory providerId={id} />
        </main>
    );
}
