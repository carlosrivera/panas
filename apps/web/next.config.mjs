/** @type {import("next").NextConfig} */
export default {
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
