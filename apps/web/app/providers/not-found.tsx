import Link from "next/link";
import { PageIntro } from "../../components/site-shell";
export default function ProviderNotFound() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="Provider not found"
                title="This connection isn’t listed."
            >
                <p>
                    Use the public directory to find a current provider
                    identifier. Browsing never reserves capacity.
                </p>
                <Link href="/providers" className="text-link">
                    Return to providers →
                </Link>
            </PageIntro>
        </main>
    );
}
