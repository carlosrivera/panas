/** @type {import("next").NextConfig} */
export default {
    output: "export",
    trailingSlash: true,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
    images: { unoptimized: true },
    transpilePackages: ["@panas/ui", "@panas/contracts"],
    devIndicators: false,
    webpack(config) {
        // Source-first workspaces retain Node ESM .js specifiers in TypeScript.
        config.resolve.extensionAlias = {
            ...config.resolve.extensionAlias,
            ".js": [".ts", ".tsx", ".js"],
        };
        return config;
    },
};
