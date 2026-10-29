import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root, revision, run } from "./runtime.js";
import { PLATFORM } from "./config.js";

if (Number(process.versions.node.split(".")[0]) !== PLATFORM.nodeMajor)
    throw new Error("Use Node 24 for the release build");
if (run("pnpm", ["--version"], true).trim() !== PLATFORM.pnpm)
    throw new Error("Pinned pnpm version required");
run("pnpm", ["--filter", "@panas/registry", "bundle"]);
run("pnpm", ["--filter", "@panas/accounting", "bundle"]);
const destination = resolve(root, "volcano/functions/operations");
await mkdir(destination, { recursive: true });
await build({
    entryPoints: [resolve(root, "scripts/platform/operations.ts")],
    outfile: resolve(destination, "index.js"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "bundle",
    external: ["pg-native"],
    define: { PANAS_RELEASE_SHA: JSON.stringify(revision()) },
    banner: {
        js: "import { createRequire as panasCreateRequire } from 'node:module'; const require = panasCreateRequire(import.meta.url);",
    },
});
await writeFile(
    resolve(destination, "package.json"),
    JSON.stringify(
        {
            name: "panas-operations-function",
            private: true,
            type: "module",
            packageManager: `pnpm@${PLATFORM.pnpm}`,
            engines: { node: ">=24 <25" },
        },
        null,
        2,
    ) + "\n",
);
run("pnpm", [
    "--dir",
    destination,
    "install",
    "--lockfile-only",
    "--ignore-workspace",
]);
console.log("Bundled all functions as isolated Node 24 ESM packages.");

const health = resolve(root, "volcano/functions/health");
await writeFile(
    resolve(health, "package.json"),
    JSON.stringify(
        {
            name: "panas-health-function",
            private: true,
            type: "module",
            packageManager: `pnpm@${PLATFORM.pnpm}`,
            engines: { node: ">=24 <25" },
        },
        null,
        2,
    ) + "\n",
);
run("pnpm", [
    "--dir",
    health,
    "install",
    "--lockfile-only",
    "--ignore-workspace",
]);
