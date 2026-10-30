import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { version } = JSON.parse(
    await readFile(resolve(root, "apps/cli/package.json"), "utf8"),
) as { version: string };
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version))
    throw new Error("Invalid release version");
execFileSync("pnpm", ["release:bundle"], { cwd: root, stdio: "inherit" });
execFileSync(
    "pnpm",
    [
        "--dir",
        "dist/panas-cli",
        "pack",
        "--out",
        resolve(root, `artifacts/panas-cli-${version}.tgz`),
    ],
    { cwd: root, stdio: "inherit" },
);
