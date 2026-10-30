import { z } from "zod";
import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { assertContainerProfile } from "./container-profile.js";
import type {
    RuntimeConfig,
    RuntimeInfo,
    InferenceRuntime,
} from "./runtime.js";
export class DockerWorkerRuntime implements InferenceRuntime {
    readonly url: URL;
    private closing = false;
    constructor(config: RuntimeConfig) {
        this.url = new URL(config.endpoint);
    }
    private async call(
        method: string,
        data: Record<string, unknown> = {},
        signal = AbortSignal.timeout(65000),
    ): Promise<unknown> {
        const token = (await readFile("/ipc/token", "utf8")).trim();
        if (!/^[a-f0-9]{64}$/.test(token))
            throw new Error("Worker token unavailable");
        return new Promise((resolve, reject) => {
            const req = request(
                {
                    socketPath: "/ipc/runtime.sock",
                    path: "/",
                    method: "POST",
                    signal,
                    headers: {
                        authorization: `Bearer ${token}`,
                        "content-type": "application/json",
                    },
                },
                (res) => {
                    let size = 0;
                    const chunks: Buffer[] = [];
                    res.on("data", (c) => {
                        size += c.length;
                        if (size > 65536)
                            res.destroy(new Error("Worker response too large"));
                        else chunks.push(c);
                    });
                    res.once("error", reject);
                    res.once("end", () => {
                        try {
                            const body = JSON.parse(
                                Buffer.concat(chunks).toString("utf8"),
                            );
                            if (res.statusCode !== 200 || body.ok !== true)
                                throw new Error("Worker operation rejected");
                            resolve(body.result);
                        } catch (error) {
                            reject(error);
                        }
                    });
                },
            );
            req.once("error", reject);
            req.end(JSON.stringify({ method, ...data }));
        });
    }
    async start() {
        if (this.closing) throw new Error("Worker shutting down");
        await this.call("start");
    }
    async stop() {
        await this.call("stop", {}, AbortSignal.timeout(5000));
    }
    beginShutdown() {
        this.closing = true;
    }
    async info(signal?: AbortSignal) {
        return (await this.call("info", {}, signal)) as RuntimeInfo;
    }
    async generate(
        prompt: string,
        maxOutputTokens: number,
        signal: AbortSignal,
    ) {
        return z
            .object({
                text: z.string().min(1).max(8192),
                inputTokens: z.number().int().min(0).max(2048),
                outputTokens: z.number().int().min(1).max(maxOutputTokens),
                durationMs: z.number().finite().nonnegative(),
                finishReason: z
                    .enum(["stop", "length", "unknown"])
                    .default("unknown"),
            })
            .strict()
            .parse(
                await this.call(
                    "generate",
                    { prompt, maxOutputTokens },
                    signal,
                ),
            );
    }
    async cancellationCheck() {
        return (await this.call("cancellationCheck")) === true;
    }
}
export async function createProviderRuntime(config: RuntimeConfig) {
    await assertContainerProfile("gateway");
    return new DockerWorkerRuntime(config);
}
