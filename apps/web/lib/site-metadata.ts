import type { Metadata } from "next";

export const siteUrl = "https://panas.mcpwire.co";
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
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: siteTitle,
    };
    return {
        title,
        description,
        alternates: { canonical: path },
        openGraph: {
            type: "website",
            siteName: "Panas",
            locale: "en_US",
            title: socialTitle,
            description,
            url: path,
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
