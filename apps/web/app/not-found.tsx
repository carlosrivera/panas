import Link from "next/link";
import { PageIntro } from "../components/site-shell";
export default function NotFound() {
    return (
        <main id="main" className="shell section">
            <PageIntro
                eyebrow="Page not found"
                title="Let’s find a useful connection."
            >
                <p>
                    This address is not part of Panas. Explore reported
                    providers or follow a setup guide to get started.
                </p>
                <Link href="/providers" className="text-link">
                    Return to providers →
                </Link>
            </PageIntro>
        </main>
    );
}
