import { it, expect } from "vitest";
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
    symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { stageApprovedModel } from "./model-stage";
const hash = (b: string) => createHash("sha256").update(b).digest("hex");
it("stages only hash-verified model data and rejects modified or symlinked blobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "panas-stage-test-"));
    try {
        await mkdir(join(dir, "manifests/registry.ollama.ai/library/qwen2.5"), {
            recursive: true,
        });
        await mkdir(join(dir, "blobs"));
        const blob = "approved weights",
            layer = {
                digest: `sha256:${hash(blob)}`,
                size: Buffer.byteLength(blob),
            };
        const raw = JSON.stringify({ config: layer, layers: [] }),
            pin = hash(raw),
            manifest = join(
                dir,
                "manifests/registry.ollama.ai/library/qwen2.5/0.5b",
            ),
            path = join(dir, "blobs", `sha256-${hash(blob)}`);
        await writeFile(manifest, raw);
        await writeFile(path, blob);
        await writeFile(join(dir, "unrelated-secret"), "never copy");
        const staged = await stageApprovedModel(dir, pin);
        try {
            expect(
                await readFile(
                    join(staged.modelsPath, "blobs", `sha256-${hash(blob)}`),
                    "utf8",
                ),
            ).toBe(blob);
            await expect(
                readFile(join(staged.modelsPath, "unrelated-secret")),
            ).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
            await staged.cleanup();
        }
        await writeFile(path, "modified weights");
        await expect(stageApprovedModel(dir, pin)).rejects.toThrow();
        await rm(path);
        await symlink(join(dir, "unrelated-secret"), path);
        await expect(stageApprovedModel(dir, pin)).rejects.toThrow();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
