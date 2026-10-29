import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export class TransportRequestError extends Error {
    constructor(
        public readonly code:
            | "disconnected"
            | "request_timeout"
            | "protocol_failed"
            | "remote_error",
        public readonly execution: "uncertain" | "rejected" = "uncertain",
    ) {
        super(`MCPWire request ${code}; do not replay automatically`);
        this.name = "TransportRequestError";
    }
}
const MAX_MESSAGE_BYTES = 1_048_576;
export class JsonRpcClient {
    private buffer = "";
    private stopped = false;
    private pending = new Map<
        string,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    constructor(
        private child: ChildProcessWithoutNullStreams,
        private onProtocolError: () => void,
    ) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (data: string) => this.read(data));
        child.on("close", () => this.close("disconnected"));
        child.on("error", () => this.close("disconnected"));
        child.stdout.on("error", () => this.close("disconnected"));
    }
    private close(code: "disconnected" | "protocol_failed") {
        this.stopped = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new TransportRequestError(code));
        }
        this.pending.clear();
    }
    private read(data: string) {
        this.buffer += data;
        if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES) {
            this.close("protocol_failed");
            this.onProtocolError();
            return;
        }
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            if (!line.trim()) continue;
            try {
                const msg: unknown = JSON.parse(line);
                if (
                    !msg ||
                    typeof msg !== "object" ||
                    !("jsonrpc" in msg) ||
                    msg.jsonrpc !== "2.0"
                )
                    throw new Error();
                if (!("id" in msg)) continue; // Notifications do not complete requests.
                const pending = this.pending.get(String(msg.id));
                if (!pending) continue; // Timed-out requests are never replayed.
                if (!("error" in msg) && !("result" in msg)) throw new Error();
                clearTimeout(pending.timer);
                this.pending.delete(String(msg.id));
                if ("error" in msg)
                    pending.reject(new TransportRequestError("remote_error"));
                else if ("result" in msg) pending.resolve(msg.result);
            } catch {
                this.close("protocol_failed");
                this.onProtocolError();
                return;
            }
        }
    }
    request(
        method: string,
        params: unknown,
        timeoutMs: number,
    ): Promise<unknown> {
        if (this.stopped)
            return Promise.reject(new TransportRequestError("disconnected"));
        const id = randomUUID();
        const message =
            JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
        if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES)
            return Promise.reject(new Error("MCP message exceeds limit"));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new TransportRequestError("request_timeout"));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.child.stdin.write(message, (error) => {
                if (error) this.close("disconnected");
            });
        });
    }
    notify(method: string) {
        if (!this.stopped)
            this.child.stdin.write(
                JSON.stringify({ jsonrpc: "2.0", method }) + "\n",
            );
    }
}
