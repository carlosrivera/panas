import { build } from "esbuild";
import { mkdir, rm, readFile, writeFile, cp, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const manifest = JSON.parse(
    await readFile(resolve(root, "apps/cli/package.json"), "utf8"),
) as { name: string; version: string };
const destination = resolve(root, "dist/panas-cli");
if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Use Node 24");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const entries = {
    "bin/panas": "apps/cli/src/cli.ts",
    "apps/provider-mcp/src/host": "apps/provider-mcp/src/host.ts",
    "apps/provider-mcp/src/main": "apps/provider-mcp/src/main.ts",
    "apps/provider/src/doctor": "apps/provider/src/doctor.ts",
    "apps/buyer-mcp/src/cli": "apps/buyer-mcp/src/cli.ts",
};
const result = await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir: destination,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "bundle",
    external: ["@mcpwire/cli", "@mcpwire/cli/*"],
    legalComments: "linked",
    metafile: true,
    banner: {
        js: "import { createRequire as panasCreateRequire } from 'node:module'; const require = panasCreateRequire(import.meta.url);",
    },
});
// Both runtime and transport locate this sibling guardian from their depth-three bundle.
await mkdir(resolve(destination, "scripts"));
await cp(
    resolve(root, "scripts/owned-process.mjs"),
    resolve(destination, "scripts/owned-process.mjs"),
);
await cp(resolve(root, "LICENSE"), resolve(destination, "LICENSE"));
await cp(
    resolve(root, "docs/distribution.md"),
    resolve(destination, "README.md"),
);
await cp(
    resolve(root, "apps/cli/provider.env.example"),
    resolve(destination, "provider.env.example"),
);
await writeFile(
    resolve(destination, "release.json"),
    JSON.stringify(
        {
            name: manifest.name,
            version: manifest.version,
            sourceCommit: run(["rev-parse", "HEAD"]),
            sourceDirty: Boolean(run(["status", "--porcelain"])),
            deployedControlPlane: "281033a964c98a9a173d440030586dd64fb7135b",
            node: process.versions.node,
            mcpwire: "1.1.0",
            ollama: "0.40.12",
            model: "qwen2.5:0.5b",
            modelDigest:
                "a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67",
        },
        null,
        2,
    ) + "\n",
);
await writeFile(
    resolve(destination, "package.json"),
    JSON.stringify(
        {
            name: manifest.name,
            version: manifest.version,
            type: "module",
            license: "MIT",
            description:
                "Panas provider and buyer CLI for the macOS inference prototype",
            bin: { panas: "bin/panas.js" },
            files: [
                "bin/",
                "apps/",
                "scripts/",
                "release.json",
                "provider.env.example",
            ],
            engines: { node: ">=24 <25" },
            repository: {
                type: "git",
                url: "https://github.com/carlosrivera/panas.git",
            },
            dependencies: { "@mcpwire/cli": "1.1.0" },
        },
        null,
        2,
    ) + "\n",
);
await chmod(resolve(destination, "bin/panas.js"), 0o755);
await mkdir(resolve(root, "artifacts"), { recursive: true });
// Metadata is outside the installable package: no repo source or source maps ship.
await writeFile(
    resolve(root, "artifacts/bundle-meta.json"),
    JSON.stringify(result.metafile, null, 2) + "\n",
);
console.log(
    `Built ${manifest.name}@${manifest.version}; MCPWire stays external and pinned.`,
);
