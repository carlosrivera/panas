import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { signalOwnedGroup } from "../../../scripts/owned-signal.js";
import { setTimeout as delay } from "node:timers/promises";

export interface RuntimeInfo {
    sandbox?: "docker-worker";
    version: string;
    digest: string;
}
export interface Generation {
    text: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    finishReason?: "stop" | "length" | "unknown";
}
export interface InferenceRuntime {
    start(): Promise<void>;
    stop(): Promise<void>;
    info(signal?: AbortSignal): Promise<RuntimeInfo>;
    generate(
        prompt: string,
        maxOutputTokens: number,
        signal: AbortSignal,
    ): Promise<Generation>;
    cancellationCheck(): Promise<boolean>;
}
export interface RuntimeConfig {
    binary: string;
    modelsPath: string;
    endpoint: string;
}
export class OllamaRuntime implements InferenceRuntime {
    private child: ChildProcess | undefined;
    private starting: Promise<void> | undefined;
    private generation = 0;
    private shuttingDown = false;
    readonly url: URL;
    constructor(readonly config: RuntimeConfig) {
        this.url = new URL(config.endpoint);
        if (
            this.url.protocol !== "http:" ||
            this.url.hostname !== "127.0.0.1" ||
            !this.url.port ||
            this.url.pathname !== "/" ||
            this.url.username ||
            this.url.password ||
            this.url.search ||
            this.url.hash
        )
            throw new Error(
                "Runtime requires explicit http://127.0.0.1:PORT loopback endpoint",
            );
    }
    private async vacant(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const socket = createConnection({
                host: "127.0.0.1",
                port: Number(this.url.port),
            });
            socket.once("connect", () => {
                socket.destroy();
                reject(
                    new Error(
                        "Runtime port already in use; refusing to adopt an existing server",
                    ),
                );
            });
            socket.once("error", (error: NodeJS.ErrnoException) => {
                socket.destroy();
                if (error.code === "ECONNREFUSED") resolve();
                else reject(error);
            });
            socket.setTimeout(1000, () => {
                socket.destroy();
                reject(new Error("Runtime port check timed out"));
            });
        });
    }
    async start(): Promise<void> {
        if (this.shuttingDown)
            throw new Error("Dedicated Ollama runtime is shutting down");
        if (this.starting) return this.starting;
        if (
            this.child?.exitCode === null &&
            this.child.signalCode === null &&
            this.child.pid
        )
            return;
        this.starting = this.launch(this.generation);
        try {
            await this.starting;
        } finally {
            this.starting = undefined;
        }
    }
    private async launch(generation: number): Promise<void> {
        await this.vacant();
        if (this.shuttingDown || generation !== this.generation)
            throw new Error("Dedicated Ollama startup cancelled");
        let launchError: Error | undefined;
        const child = spawn(
            process.execPath,
            [
                fileURLToPath(
                    new URL(
                        "../../../scripts/owned-process.mjs",
                        import.meta.url,
                    ),
                ),
                this.config.binary,
                "serve",
            ],
            {
                detached: true,
                stdio: ["ignore", "ignore", "ignore", "ipc"],
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    TMPDIR: process.env.TMPDIR,
                    OLLAMA_HOST: this.url.host,
                    OLLAMA_MODELS: this.config.modelsPath,
                    OLLAMA_NUM_PARALLEL: "1",
                    OLLAMA_MAX_LOADED_MODELS: "1",
                    OLLAMA_CONTEXT_LENGTH: "2048",
                    OLLAMA_NO_CLOUD: "1",
                },
            },
        );
        this.child = child;
        child.on("error", (error) => {
            launchError = error;
        });
        for (let attempt = 0; attempt < 100; attempt++) {
            if (this.shuttingDown || generation !== this.generation)
                throw new Error("Dedicated Ollama startup cancelled");
            if (
                launchError ||
                child.exitCode !== null ||
                child.signalCode !== null
            ) {
                await this.stop();
                throw new Error("Dedicated Ollama failed to start");
            }
            try {
                await this.json("/api/version");
                if (this.shuttingDown || generation !== this.generation)
                    throw new Error("Dedicated Ollama startup cancelled");
                return;
            } catch {
                await delay(100);
            }
        }
        await this.stop();
        throw new Error("Dedicated Ollama startup timed out");
    }
    /** Seal the host lifecycle before awaiting transport or capability-test cleanup. */
    beginShutdown(): void {
        this.shuttingDown = true;
        this.generation++;
    }
    async stop(): Promise<void> {
        this.generation++;
        const child = this.child;
        this.child = undefined;
        if (!child?.pid) return;
        await signalOwnedGroup(child, "SIGTERM");
        await Promise.race([
            new Promise<void>((resolve) =>
                child.exitCode !== null || child.signalCode !== null
                    ? resolve()
                    : child.once("exit", () => resolve()),
            ),
            delay(1000),
        ]);
        await signalOwnedGroup(child, "SIGKILL");
    }
    private async json(
        path: string,
        body?: unknown,
        signal = AbortSignal.timeout(5000),
    ): Promise<Record<string, unknown>> {
        const response = await fetch(new URL(path, this.url), {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal,
            redirect: "error",
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        return (await response.json()) as Record<string, unknown>;
    }
    async info(signal = AbortSignal.timeout(5000)): Promise<RuntimeInfo> {
        const version = await this.json("/api/version", undefined, signal);
        const tags = await this.json("/api/tags", undefined, signal);
        const models = tags.models;
        const installed = Array.isArray(models)
            ? models.find(
                  (m: Record<string, unknown>) => m.name === "qwen2.5:0.5b",
              )
            : undefined;
        if (
            !installed ||
            typeof installed.digest !== "string" ||
            typeof version.version !== "string"
        )
            throw new Error(
                "Approved model missing; install it explicitly before launch",
            );
        return { version: version.version, digest: installed.digest };
    }
    async generate(
        prompt: string,
        maxOutputTokens: number,
        signal: AbortSignal,
    ): Promise<Generation> {
        const start = performance.now();
        const body = await this.json(
            "/api/generate",
            {
                model: "qwen2.5:0.5b",
                prompt,
                raw: true,
                stream: false,
                keep_alive: "5m",
                options: {
                    num_ctx: 2048,
                    num_predict: maxOutputTokens,
                    temperature: 0,
                },
            },
            signal,
        );
        if (
            body.done !== true ||
            typeof body.response !== "string" ||
            !body.response.trim() ||
            !Number.isInteger(body.prompt_eval_count) ||
            !Number.isInteger(body.eval_count) ||
            Number(body.eval_count) < 1 ||
            Number(body.prompt_eval_count) < 0 ||
            Number(body.eval_count) > maxOutputTokens ||
            Number(body.prompt_eval_count) > 2048
        )
            throw new Error("Invalid or out-of-profile inference completion");
        return {
            text: body.response,
            inputTokens: Number(body.prompt_eval_count),
            outputTokens: Number(body.eval_count),
            durationMs: performance.now() - start,
            finishReason:
                body.done_reason === "stop" || body.done_reason === "length"
                    ? body.done_reason
                    : "unknown",
        };
    }
    async cancellationCheck(): Promise<boolean> {
        const abort = new AbortController();
        const pending = this.generate(
            "Count all integers from one upward, separated by spaces.",
            128,
            abort.signal,
        );
        const timer = setTimeout(() => abort.abort(), 5);
        let aborted = false;
        try {
            await pending;
        } catch {
            aborted = abort.signal.aborted;
        } finally {
            clearTimeout(timer);
            await this.stop();
        }
        // Killing the owned process group is the cancellation fail-safe. Never kill an adopted runtime.
        await this.start();
        return aborted;
    }
}
