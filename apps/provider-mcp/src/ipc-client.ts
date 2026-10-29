import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";

export async function callDaemon(
    socketPath: string,
    tokenPath: string,
    method: string,
    body: Record<string, unknown> = {},
): Promise<unknown> {
    const token = await readFile(tokenPath, "utf8");
    return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let buffer = "";
        socket.setEncoding("utf8");
        socket.setTimeout(15000, () =>
            socket.destroy(new Error("DAEMON_TIMEOUT")),
        );
        socket.once("connect", () =>
            socket.write(JSON.stringify({ ...body, token, method }) + "\n"),
        );
        socket.on("data", (chunk) => {
            buffer += chunk;
            if (Buffer.byteLength(buffer) > 262144)
                socket.destroy(new Error("DAEMON_RESPONSE_TOO_LARGE"));
        });
        socket.once("error", () => reject(new Error("DAEMON_UNAVAILABLE")));
        socket.once("end", () => {
            let result: { ok?: boolean; result?: unknown; error?: unknown };
            try {
                result = JSON.parse(buffer) as typeof result;
                if (!result || typeof result !== "object") throw new Error();
            } catch {
                reject(new Error("DAEMON_REJECTED"));
                return;
            }
            if (result.ok !== true) {
                // Only bounded code tokens cross this private boundary. The MCP adapter
                // applies its narrower public allowlist before returning a tool error.
                reject(
                    new Error(
                        typeof result.error === "string" &&
                            /^[A-Z_]{1,64}$/.test(result.error)
                            ? result.error
                            : "DAEMON_REJECTED",
                    ),
                );
                return;
            }
            resolve(result.result);
        });
    });
}
