import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
    mkdtemp,
    mkdir,
    readFile,
    copyFile,
    chmod,
    lstat,
    rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
async function digest(path: string) {
    const h = createHash("sha256");
    for await (const c of createReadStream(path)) h.update(c);
    return h.digest("hex");
}
export async function stageApprovedModel(
    source: string,
    expectedDigest: string,
) {
    const directory = await mkdtemp(join(tmpdir(), "panas-docker-model-")),
        models = join(directory, "models");
    try {
        const manifestPath =
            "manifests/registry.ollama.ai/library/qwen2.5/0.5b";
        if (!(await lstat(source)).isDirectory())
            throw new Error("Real model directory required");
        const pin = expectedDigest.replace(/^sha256:/, "");
        if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error("Model pin required");
        let manifest: Buffer | undefined;
        // Select only content that hashes to the approved OCI manifest. Support the pinned
        // runtime's v2 cache and its content-addressed original, without trusting a wrapper.
        for (const candidate of [
            join(source, "blobs", `sha256-${pin}`),
            join(source, "manifests-v2/ollama.com/library/qwen2.5/0.5b"),
            join(source, manifestPath),
        ]) {
            try {
                const info = await lstat(candidate);
                if (!info.isFile() || info.size > 65536) continue;
                const bytes = await readFile(candidate);
                if (createHash("sha256").update(bytes).digest("hex") === pin) {
                    manifest = bytes;
                    break;
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
            }
        }
        if (!manifest)
            throw new Error("Pinned model manifest missing or changed");
        const parsed = JSON.parse(manifest.toString("utf8"));
        const blobs = [parsed.config, ...parsed.layers] as {
            digest: string;
            size: number;
        }[];
        if (blobs.length > 16) throw new Error("Unexpected model layers");
        await mkdir(
            join(models, "manifests/registry.ollama.ai/library/qwen2.5"),
            { recursive: true, mode: 0o755 },
        );
        await mkdir(join(models, "blobs"), { mode: 0o755 });
        await mkdir(join(models, "manifests-v2/ollama.com/library/qwen2.5"), {
            recursive: true,
            mode: 0o755,
        });
        await import("node:fs/promises").then((fs) =>
            fs.writeFile(
                join(models, "manifests-v2/ollama.com/library/qwen2.5/0.5b"),
                manifest,
                { mode: 0o644 },
            ),
        );
        await import("node:fs/promises").then((fs) =>
            fs.writeFile(join(models, manifestPath), manifest, { mode: 0o644 }),
        );
        let bytes = 0;
        for (const blob of blobs) {
            if (
                !/^sha256:[a-f0-9]{64}$/.test(blob.digest) ||
                !Number.isSafeInteger(blob.size) ||
                blob.size < 0 ||
                (bytes += blob.size) > 1024 ** 3
            )
                throw new Error("Model layer rejected");
            const name = blob.digest.replace(":", "-"),
                from = join(source, "blobs", name),
                to = join(models, "blobs", name);
            const info = await lstat(from);
            if (!info.isFile() || info.size !== blob.size)
                throw new Error("Model layer file rejected");
            await copyFile(from, to);
            if ((await digest(to)) !== blob.digest.slice(7))
                throw new Error("Model layer digest mismatch");
            await chmod(to, 0o644);
        }
        await chmod(models, 0o755);
        return {
            modelsPath: models,
            cleanup: () => rm(directory, { recursive: true, force: true }),
        };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}
