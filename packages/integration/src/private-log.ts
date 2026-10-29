import { createWriteStream, type ReadStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
/** Raw diagnostics can contain private values. Only owner-only bounded files may receive them. */
export function retainPrivateDiagnostics(
    directory: string,
    label: string,
    streams: (Readable | ReadStream | null | undefined)[],
    maxBytes = 65536,
): () => void {
    const path = join(directory, `${label}-${randomUUID()}.diagnostic.log`);
    const out = createWriteStream(path, { flags: "wx", mode: 0o600 });
    let bytes = 0;
    out.on("error", () => {});
    for (const stream of streams)
        stream?.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = maxBytes - bytes;
            if (remaining > 0) {
                out.write(buffer.subarray(0, remaining));
                bytes += Math.min(buffer.length, remaining);
            }
        });
    return () => out.end();
}
