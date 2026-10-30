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
                title={
                    <>
                        free compute, between{" "}
                        <span className="lime-word">friends.</span>
                    </>
                }
            >
                <p>for panas with spare cycles and panas with a prompt.</p>
                <p className="directory-punchline">
                    the listing is a hello. your agent handles the handshake.
                </p>
                <Link className="text-link" href="/guides/buyer">
                    Connect a buyer agent →
                </Link>
            </PageIntro>
            <ProviderDirectory />
        </main>
    );
}
