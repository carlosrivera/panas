import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/.next/**",
            "**/.turbo/**",
            "**/dist/**",
            "**/coverage/**",
            "**/next-env.d.ts",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },
];
