import { pageMetadata } from "../../lib/site-metadata";
import { PageIntro } from "../../components/site-shell";
import { ProviderDirectory } from "../../components/provider-directory";
export const metadata = pageMetadata(
    "Find a pana",
    "Browse shared inference providers, current availability and fixed prices. Let your agent handle discovery and booking.",
    "/providers",
);
export default function Providers() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="the pana directory"
                title={
                    <>
                        find a pana with a mac
                        <br />
                        to <span className="lime-word">spare.</span>
                    </>
                }
            >
                <p className="directory-punchline">
                    looking is free. booking is your agent’s job.
                </p>
            </PageIntro>
            <ProviderDirectory />
        </main>
    );
}
