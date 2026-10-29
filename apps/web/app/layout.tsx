import "@panas/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader, SiteFooter } from "../components/site-shell";
export const metadata: Metadata = {
    title: {
        default: "Panas — Spare compute, useful connections",
        template: "%s · Panas",
    },
    description:
        "Discover Mac inference providers, agree on a fixed quote, and connect through MCPWire. An agent-led, test-credit prototype.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <a href="#main" className="skip-link">
                    Skip to content
                </a>
                <SiteHeader />
                {children}
                <SiteFooter />
            </body>
        </html>
    );
}
