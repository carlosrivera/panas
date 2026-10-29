import "@panas/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
    title: "Panas — Spare compute, shared with your agent",
    description:
        "Discover peers, agree on a fixed price, and run bounded inference on a provider’s Mac through MCPWire. Panas is in development.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
