import { mkdtemp, rm, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function withReleaseImage(
    version: string,
    load: (path: string) => Promise<unknown>,
) {
    if (!/^0\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?$/.test(version))
        throw new Error("Release version rejected");
    const filename = `panas-provider-${version}-linux-arm64.tar.gz`,
        base = `https://github.com/carlosrivera/panas/releases/download/v${version}`;
    const sumsResponse = await fetch(`${base}/SHA256SUMS`, {
        signal: AbortSignal.timeout(30000),
    });
    if (!sumsResponse.ok) throw new Error("Sandbox release unavailable");
    const sums = await sumsResponse.text();
    if (sums.length > 65536) throw new Error("Invalid release checksums");
    const expected = sums
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((row) => row[1] === filename);
    if (expected.length !== 1 || !/^[a-f0-9]{64}$/.test(expected[0]?.[0] ?? ""))
        throw new Error("Sandbox checksum missing");
    const directory = await mkdtemp(join(tmpdir(), "panas-image-"));
    try {
        const response = await fetch(`${base}/${filename}`, {
            signal: AbortSignal.timeout(300000),
        });
        if (!response.ok || !response.body)
            throw new Error("Sandbox image unavailable");
        const path = join(directory, filename),
            file = await open(path, "wx", 0o600),
            hash = createHash("sha256");
        let size = 0;
        try {
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > 1024 ** 3)
                    throw new Error("Sandbox image too large");
                hash.update(chunk);
                await file.write(chunk);
            }
        } finally {
            await file.close();
        }
        if (hash.digest("hex") !== expected[0]![0])
            throw new Error("Sandbox checksum mismatch");
        await load(path);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
