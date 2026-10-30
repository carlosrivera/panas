import "@panas/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFrame } from "../components/site-frame";
export const metadata: Metadata = {
    title: {
        default: "Panas — Your agent needs compute. Your pana has it.",
        template: "%s · Panas",
    },
    description:
        "Turn shared computers into inference infrastructure for AI agents. MCP discovery, encrypted peer connections, Docker execution, and Solana devnet USDC payments.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <a href="#main" className="skip-link">
                    Skip to content
                </a>
                <SiteFrame>{children}</SiteFrame>
            </body>
        </html>
    );
}
