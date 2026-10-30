import "@panas/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
    pageMetadata,
    siteUrl,
    siteTitle,
    siteDescription,
} from "../lib/site-metadata";
import { SiteFrame } from "../components/site-frame";
export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    ...pageMetadata(siteTitle, siteDescription, "/"),
    title: { default: siteTitle, template: "%s · Panas" },
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
