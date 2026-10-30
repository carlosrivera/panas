import base from "@panas/eslint-config";
export default [
    ...base,
    {
        ignores: [
            "**/out/**",
            "**/.wrangler/**",
            "volcano/functions/registry/index.js",
            "volcano/functions/accounting/index.js",
            "volcano/functions/operations/index.js",
        ],
    },
];
