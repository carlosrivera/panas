import type { Metadata } from "next";

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://panas.mcpwire.co"
).replace(/\/$/, "");
export function sitePath(path: string) {
    return `${basePath}${path}`;
}
export const siteTitle = "Panas — Your agent needs compute. Your pana has it.";
export const siteDescription =
    "Share spare compute with AI agents. Discover providers through MCP, run inference over encrypted peer connections, and share for free or charge Solana devnet USDC.";

export function pageMetadata(
    title: string,
    description: string,
    path: string,
): Metadata {
    const socialTitle = path === "/" ? title : `${title} · Panas`;
    const image = {
        url: `${siteUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: siteTitle,
    };
    return {
        title,
        description,
        alternates: { canonical: `${siteUrl}${path}` },
        openGraph: {
            type: "website",
            siteName: "Panas",
            locale: "en_US",
            title: socialTitle,
            description,
            url: `${siteUrl}${path}`,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title: socialTitle,
            description,
            images: [image],
        },
    };
}
