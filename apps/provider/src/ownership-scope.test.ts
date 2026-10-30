import { it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimProviderHost } from "./ownership";
it("refuses a live same-scope owner but recovers a reused PID from a retired Docker namespace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "panas-container-owner-"));
    try {
        const old = "docker:aaaaaaaaaaaa:pid:[123]",
            next = "docker:bbbbbbbbbbbb:pid:[124]";
        await claimProviderHost(dir, old);
        await expect(claimProviderHost(dir, old)).rejects.toThrow(
            "ALREADY_RUNNING",
        );
        // The persisted PID is deliberately still live here: another container has a distinct namespace.
        expect(
            JSON.parse(await readFile(join(dir, "host.owner.json"), "utf8"))
                .pid,
        ).toBe(process.pid);
        expect(await claimProviderHost(dir, next)).toEqual({ recovered: true });
        await expect(claimProviderHost(dir)).rejects.toThrow(
            "SCOPE_REQUIRES_REVIEW",
        );
        await writeFile(
            join(dir, "host.owner.json"),
            JSON.stringify({
                version: 1,
                pid: process.pid,
                instance: "legacy",
            }),
            { mode: 0o600 },
        );
        await expect(claimProviderHost(dir, next)).rejects.toThrow(
            "SCOPE_REQUIRES_REVIEW",
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
