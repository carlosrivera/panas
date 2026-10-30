import { it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { withReleaseImage } from "./sandbox-image";
afterEach(() => vi.unstubAllGlobals());
it("verifies release image bytes before loading and removes its temporary archive", async () => {
    const bytes = Buffer.from("fixture image archive"),
        sha = createHash("sha256").update(bytes).digest("hex"),
        name = "panas-provider-0.1.0-alpha.5-linux-arm64.tar.gz";
    let checksum = sha;
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async (url: string) =>
                new Response(
                    url.endsWith("SHA256SUMS")
                        ? `${checksum}  ${name}\n`
                        : bytes,
                ),
        ),
    );
    let path = "";
    const load = vi.fn(async (p: string) => {
        path = p;
        expect(await readFile(p)).toEqual(bytes);
    });
    await withReleaseImage("0.1.0-alpha.5", load);
    expect(load).toHaveBeenCalledOnce();
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    checksum = "0".repeat(64);
    load.mockClear();
    await expect(withReleaseImage("0.1.0-alpha.5", load)).rejects.toThrow(
        "checksum mismatch",
    );
    expect(load).not.toHaveBeenCalled();
});
