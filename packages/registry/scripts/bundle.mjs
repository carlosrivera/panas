import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const destination = new URL(
    "../../../volcano/functions/registry/",
    import.meta.url,
);
await mkdir(destination, { recursive: true });
await build({
    entryPoints: [new URL("../src/volcano.ts", import.meta.url).pathname],
    outfile: new URL("index.js", destination).pathname,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
        js: "import { createRequire as panasCreateRequire } from 'node:module'; const require = panasCreateRequire(import.meta.url);",
    },
    packages: "bundle",
    external: ["pg-native"],
    sourcemap: false,
});
await writeFile(
    new URL("package.json", destination),
    JSON.stringify(
        {
            name: "panas-registry-function",
            private: true,
            packageManager: "pnpm@12.16.1",
            type: "module",
            engines: { node: ">=24 <25" },
        },
        null,
        2,
    ) + "\n",
);
console.log(
    "Bundled registry HTTP function. Generated index.js must be built before deploy.",
);

const install = spawnSync(
    "pnpm",
    ["install", "--lockfile-only", "--ignore-workspace"],
    { cwd: destination, stdio: "inherit", shell: false },
);
if (install.status !== 0)
    throw new Error("Could not generate the isolated function lockfile");
