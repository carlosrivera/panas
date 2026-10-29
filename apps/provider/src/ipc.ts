import { createServer, type Server } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { ProviderDaemon, ProviderError } from "./daemon.js";

export async function serveLocal(
    daemon: ProviderDaemon,
    socketPath: string,
    token: string,
): Promise<Server> {
    try {
        await lstat(socketPath);
        throw new Error("IPC path already exists; refusing to replace it");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const server = createServer((socket) => {
        socket.setEncoding("utf8");
        let buffer = "",
            handled = false;
        socket.setTimeout(5000, () => socket.destroy());
        socket.on("error", () => {});
        socket.on("data", (chunk) => {
            if (handled) return;
            buffer += chunk.toString();
            if (Buffer.byteLength(buffer) > 16384) {
                socket.destroy();
                return;
            }
            if (!buffer.includes("\n")) return;
            handled = true;
            void (async () => {
                try {
                    const body = JSON.parse(
                        buffer.slice(0, buffer.indexOf("\n")),
                    ) as Record<string, unknown>;
                    const supplied = Buffer.from(
                        typeof body.token === "string" ? body.token : "",
                    );
                    const expected = Buffer.from(token);
                    if (
                        supplied.length !== expected.length ||
                        !timingSafeEqual(supplied, expected)
                    )
                        throw new Error("UNAUTHORIZED");
                    let result: unknown;
                    switch (body.method) {
                        case "status":
                            result = daemon.status;
                            break;
                        case "heartbeat":
                            result = daemon.heartbeat();
                            break;
                        case "pause":
                            daemon.pause();
                            result = daemon.status;
                            break;
                        case "resume":
                            daemon.resume();
                            result = daemon.status;
                            break;
                        case "drain":
                            daemon.drain();
                            result = daemon.status;
                            break;
                        case "stop":
                            await daemon.emergencyStop();
                            result = daemon.status;
                            break;
                        case "retest":
                            result = await daemon.retest();
                            break;
                        case "submit":
                            result = await daemon.submit(
                                body.request,
                                String(body.buyerKeyId ?? ""),
                            );
                            break;
                        case "get":
                            result = await daemon.get(
                                String(body.requestId ?? ""),
                                String(body.buyerKeyId ?? ""),
                            );
                            break;
                        case "cancel":
                            result = await daemon.cancel(
                                String(body.requestId ?? ""),
                                String(body.buyerKeyId ?? ""),
                            );
                            break;
                        default:
                            throw new Error("UNKNOWN_METHOD");
                    }
                    socket.end(
                        JSON.stringify({ ok: true, result: result ?? null }) +
                            "\n",
                    );
                } catch (error) {
                    socket.end(
                        JSON.stringify({
                            ok: false,
                            error:
                                error instanceof ProviderError
                                    ? error.code
                                    : "IPC_REQUEST_REJECTED",
                        }) + "\n",
                    );
                }
            })();
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => {
            server.off("error", reject);
            resolve();
        });
    });
    await chmod(socketPath, 0o600);
    server.once("close", () => {
        void unlink(socketPath).catch(() => {});
    });
    return server;
}
