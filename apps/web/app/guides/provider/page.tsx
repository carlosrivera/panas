import type { Metadata } from "next";
import { PageIntro } from "../../../components/site-shell";
export const metadata: Metadata = { title: "Provider setup" };
export default function ProviderGuide() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="Provider setup"
                title="Put your Mac in good company."
            >
                <p>
                    The prototype serves bounded text inference from an approved
                    small model running natively on an Apple Silicon Mac.
                </p>
            </PageIntro>
            <div className="notice-card">
                <h2>Prepare before becoming discoverable.</h2>
                <p>
                    You need macOS, native Ollama, the explicitly downloaded
                    approved model, and operator enrollment. Fresh launch checks
                    and a separate-peer probe gate readiness.
                </p>
                <a
                    className="text-link"
                    href="https://github.com/carlosrivera/panas/blob/main/apps/provider-mcp/README.md"
                >
                    Open provider setup documentation ↗
                </a>
                <p className="small-note">
                    The step-by-step website guide follows in the next frontend
                    slice. A signed capability report is a provider assertion,
                    not hardware attestation.
                </p>
            </div>
        </main>
    );
}
