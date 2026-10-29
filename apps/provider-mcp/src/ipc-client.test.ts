import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { it, expect } from "vitest";
import { callDaemon } from "./ipc-client.js";
it("preserves real daemon rejection codes over Unix IPC and sanitizes malformed/private errors", async () => {
    const dir = await mkdtemp("/tmp/panas-ipc-test-");
    const path = join(dir, "daemon.sock"),
        token = join(dir, "token");
    await writeFile(token, "test-token", { mode: 0o600 });
    let reply = JSON.stringify({ ok: false, error: "QUEUE_FULL" });
    const server = createServer((socket) => {
        socket.once("data", () => socket.end(reply));
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
        for (const code of [
            "QUEUE_FULL",
            "REQUEST_NOT_FOUND",
            "INVALID_PLATFORM_GRANT",
            "REPLAYED_OPERATION",
        ]) {
            reply = JSON.stringify({ ok: false, error: code });
            await expect(callDaemon(path, token, "paid")).rejects.toThrow(code);
        }
        for (const value of [
            "bad-json",
            "null",
            JSON.stringify({
                ok: false,
                error: "private ticket or database URL",
            }),
        ]) {
            reply = value;
            await expect(callDaemon(path, token, "paid")).rejects.toThrow(
                "DAEMON_REJECTED",
            );
        }
        reply = JSON.stringify({ ok: true, result: { status: "completed" } });
        await expect(callDaemon(path, token, "status")).resolves.toEqual({
            status: "completed",
        });
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(dir, { recursive: true, force: true });
    }
});
