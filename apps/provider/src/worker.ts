import { createServer } from "node:http";
import { mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { OllamaRuntime } from "./runtime.js";
import { assertContainerProfile } from "./container-profile.js";

await assertContainerProfile("worker");
const runtime = new OllamaRuntime({
    binary: "/usr/bin/ollama",
    modelsPath: "/models",
    endpoint: "http://127.0.0.1:11536",
});
const token = randomBytes(32).toString("hex");
await mkdir("/ipc", { recursive: true, mode: 0o700 });
await rm("/ipc/runtime.sock", { force: true });
await writeFile("/ipc/token", token, { mode: 0o600 });
const input = z.discriminatedUnion("method", [
    z
        .object({
            method: z.enum(["start", "stop", "info", "cancellationCheck"]),
        })
        .strict(),
    z
        .object({
            method: z.literal("generate"),
            prompt: z.string().min(1).max(8192),
            maxOutputTokens: z.number().int().min(1).max(128),
        })
        .strict(),
]);
let active = false;
const server = createServer(async (req, res) => {
    const abort = new AbortController();
    res.once("close", () => {
        if (!res.writableEnded) {
            abort.abort();
            void runtime.stop();
        }
    });
    try {
        const supplied = Buffer.from(req.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${token}`);
        if (
            req.method !== "POST" ||
            req.url !== "/" ||
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)
        )
            throw new Error("Unauthorized");
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const c of req) {
            size += c.length;
            if (size > 16384) throw new Error("Oversize input");
            chunks.push(c);
        }
        const body = input.parse(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        let result: unknown = null;
        if (body.method === "stop") await runtime.stop();
        else if (body.method === "start") await runtime.start();
        else if (body.method === "info")
            result = { ...(await runtime.info()), sandbox: "docker-worker" };
        else if (body.method === "cancellationCheck")
            result = await runtime.cancellationCheck();
        else if (body.method === "generate") {
            if (active) throw new Error("Worker busy");
            if (
                Buffer.byteLength(body.prompt, "utf8") >
                2048 - body.maxOutputTokens
            )
                throw new Error("Input exceeds profile");
            active = true;
            try {
                result = await runtime.generate(
                    body.prompt,
                    body.maxOutputTokens,
                    abort.signal,
                );
            } finally {
                active = false;
            }
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, result }));
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
    }
});
server.requestTimeout = 70000;
server.headersTimeout = 5000;
server.maxConnections = 8;
await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen("/ipc/runtime.sock", resolve);
});
await chmod("/ipc/runtime.sock", 0o600);
let closing = false;
const stop = () => {
    if (closing) return;
    closing = true;
    runtime.beginShutdown();
    server.close();
    void runtime.stop().finally(() => process.exit(0));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
console.log(
    JSON.stringify({
        state: "worker-ready",
        sandbox: "docker",
        network: "none",
    }),
);
