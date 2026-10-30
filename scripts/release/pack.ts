import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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

const artifact = resolve(root, `artifacts/panas-cli-${version}.tgz`);
const checksum = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
const release = JSON.parse(
    await readFile(resolve(root, "dist/panas-cli/release.json"), "utf8"),
) as { sourceCommit: string };
const installer = (
    await readFile(resolve(root, "scripts/release/install.sh"), "utf8")
)
    .replaceAll("__PANAS_VERSION__", version)
    .replaceAll("__PANAS_SHA256__", checksum)
    .replaceAll("__PANAS_COMMIT__", release.sourceCommit);
await writeFile(resolve(root, "artifacts/install.sh"), installer, {
    mode: 0o755,
});
