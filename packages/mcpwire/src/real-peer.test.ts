import { expect, it } from "vitest";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { superviseShare, superviseJoin, probePeer } from "./index";

it.skipIf(process.env.PANAS_REAL_PEER !== "1")(
    "real CLI: separate peers, disposable adapters, persistent daemon, restart, no replay",
    async () => {
        const temp = mkdtempSync(join(tmpdir(), "panas-peer-"));
        const socketPath = join(temp, "daemon.sock");
        const daemonId = randomUUID();
        let calls = 0;
        const daemon = createServer((socket) =>
            socket.end(JSON.stringify({ daemonId, calls: ++calls })),
        );
        await new Promise<void>((resolve, reject) => {
            daemon.once("error", reject);
            daemon.listen(socketPath, resolve);
        });
        const startupId = randomUUID();
        const server = fileURLToPath(
            new URL("../test/fixtures/server.mjs", import.meta.url),
        );
        const host = superviseShare({
            command: process.execPath,
            args: [server, startupId, socketPath],
            startupTimeoutMs: 45_000,
        });
        const sessions: { stop(): Promise<void> }[] = [host];
        try {
            const ready = await host.ready;
            expect(ready.kind).toBe("ready");
            if (ready.kind !== "ready")
                throw new Error("Real host failed startup");
            const connect = async () => {
                const peer = superviseJoin({
                    ticket: ready.ticket,
                    startupTimeoutMs: 45_000,
                });
                sessions.push(peer);
                expect((await peer.ready).kind).toBe("ready");
                const result = (await peer.request(
                    "tools/call",
                    { name: "get_capabilities", arguments: {} },
                    { timeoutMs: 10_000 },
                )) as {
                    structuredContent: {
                        startupId: string;
                        pid: number;
                        daemonId: string;
                        calls: number;
                    };
                };
                return { peer, result: result.structuredContent };
            };
            const first = await connect();
            expect(first.result).toMatchObject({
                startupId,
                daemonId,
                calls: 1,
            });
            await first.peer.stop();
            await first.peer.closed;
            const second = await connect();
            expect(second.result).toMatchObject({
                startupId,
                daemonId,
                calls: 2,
            });
            expect(second.result.pid).not.toBe(first.result.pid);
            await second.peer.stop();
            await second.peer.closed;
            const probe = await probePeer({
                ticket: ready.ticket,
                startupId,
                timeoutMs: 45_000,
            });
            expect(probe.status).toBe("verified");
            expect(calls).toBe(3);
            await host.stop();
            await host.closed;
            const replacement = superviseShare({
                command: process.execPath,
                args: [server, randomUUID(), socketPath],
                startupTimeoutMs: 45_000,
            });
            sessions.push(replacement);
            const rotated = await replacement.ready;
            expect(rotated.kind).toBe("ready");
            if (rotated.kind === "ready")
                expect(rotated.ticket).not.toBe(ready.ticket);
            expect(calls).toBe(3); // Restarting transport performs no application call replay.
        } finally {
            await Promise.all(sessions.map((session) => session.stop()));
            await new Promise<void>((resolve) => daemon.close(() => resolve()));
            rmSync(temp, { recursive: true, force: true });
        }
    },
    180_000,
);
