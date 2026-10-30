import type { Metadata } from "next";
import { PageIntro } from "../../components/site-shell";
import { ProviderDirectory } from "../../components/provider-directory";
export const metadata: Metadata = { title: "Provider directory" };
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
