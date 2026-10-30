import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "panas-installer-"));
try {
    const mock = join(work, "mock");
    await mkdir(mock);
    // Intercept only downloads to serve the just-built release, exercising real
    // checksum verification, npm installation and persistent CLI path creation.
    await writeFile(
        join(mock, "curl"),
        `#!/bin/sh
set -eu
url=''
out=''
while [ "$#" -gt 0 ]; do
 case "$1" in --output) shift; out=$1 ;; https://*) url=$1 ;; esac
 shift
done
cp "$PANAS_TEST_ARTIFACTS/\${url##*/}" "$out"
if [ "\${PANAS_TEST_CORRUPT:-0}" = 1 ]; then printf corrupt >> "$out"; fi
`,
        { mode: 0o755 },
    );
    const installRoot = join(work, "persistent install's");
    const binDir = join(work, "bin");
    const env = {
        ...process.env,
        PATH: `${mock}:${process.env.PATH}`,
        PANAS_INSTALL_DIR: installRoot,
        PANAS_BIN_DIR: binDir,
        PANAS_TEST_ARTIFACTS: resolve(root, "artifacts"),
    };
    const run = (extra = {}) =>
        execFileSync("sh", [resolve(root, "artifacts/install.sh")], {
            cwd: work,
            env: { ...env, ...extra },
            stdio: "pipe",
            timeout: 120000,
        });
    assert.throws(() => run({ PANAS_TEST_CORRUPT: "1" }));
    run();
    const binary = join(binDir, "panas");
    const first = execFileSync(binary, ["--version"], {
        encoding: "utf8",
        env,
    });
    run();
    assert.equal(
        execFileSync(binary, ["--version"], { encoding: "utf8", env }),
        first,
    );
    assert.equal(
        JSON.parse(first).isolation,
        "docker-gateway-offline-worker-cpu",
    );
    // No shell profile/PATH edits or unrelated executable replacement.
    await rm(binary);
    await writeFile(binary, "unrelated", { mode: 0o755 });
    assert.throws(() => run());
    assert.equal(await readFile(binary, "utf8"), "unrelated");
    console.log(
        "Installer: checksum rejection, real npm install, paths with spaces, repeat install and unrelated executable protection passed.",
    );
} finally {
    await rm(work, { recursive: true, force: true });
}
