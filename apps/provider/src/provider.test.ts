import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderDaemon } from "./daemon.js";
import { EncryptedStore } from "./store.js";
import {
    testCapabilities,
    type CapabilityConfig,
    type HostInfo,
} from "./capabilities.js";
import {
    OllamaRuntime,
    type InferenceRuntime,
    type Generation,
} from "./runtime.js";
import { serveLocal } from "./ipc.js";
import { isReadyCapabilityReport } from "@panas/contracts/provider";

const directories: string[] = [];
afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(
        directories
            .splice(0)
            .map((p) => rm(p, { recursive: true, force: true })),
    );
});
const host: HostInfo = {
    platform: "darwin",
    architecture: "arm64",
    osMajor: 14,
    memoryBytes: 8 * 1024 ** 3,
    freeDiskBytes: 4 * 1024 ** 3,
};
const config: CapabilityConfig = {
    providerId: randomUUID(),
    expectedDigest: "a".repeat(64),
    expectedRuntimeVersion: "0.40.12",
    dataPath: "/tmp",
};
class FakeRuntime implements InferenceRuntime {
    stopped = 0;
    started = 0;
    fail = false;
    version = config.expectedRuntimeVersion;
    digest = config.expectedDigest;
    inFlight = 0;
    maxInFlight = 0;
    block = false;
    calls = 0;
    complete: (() => void)[] = [];
    async start() {
        this.started++;
    }
    async stop() {
        this.stopped++;
    }
    async info() {
        if (this.fail) throw new Error("offline");
        return { version: this.version, digest: this.digest };
    }
    async cancellationCheck() {
        return true;
    }
    async generate(
        prompt: string,
        maxOutputTokens: number,
        signal: AbortSignal,
    ): Promise<Generation> {
        this.calls++;
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
            if (this.block)
                await new Promise<void>((resolve, reject) => {
                    this.complete.push(resolve);
                    if (signal.aborted) reject(signal.reason);
                    else
                        signal.addEventListener(
                            "abort",
                            () => reject(signal.reason),
                            { once: true },
                        );
                });
            return {
                text: `output:${prompt}`,
                inputTokens: 4,
                outputTokens: Math.min(4, maxOutputTokens),
                durationMs: 10,
            };
        } finally {
            this.inFlight--;
        }
    }
}
async function fixture() {
    const path = await mkdtemp(join(tmpdir(), "panas-provider-"));
    directories.push(path);
    const runtime = new FakeRuntime();
    const store = new EncryptedStore(path);
    const daemon = new ProviderDaemon(
        { ...config, dataPath: path },
        runtime,
        store,
        async () => host,
    );
    await daemon.launch();
    return { path, runtime, store, daemon };
}
function ready(daemon: ProviderDaemon) {
    daemon.verifyPeer({
        startupId: daemon.report!.startupId,
        status: "verified",
        testedAt: new Date().toISOString(),
    });
}
function request(prompt = "hello") {
    return {
        requestId: randomUUID(),
        quoteId: randomUUID(),
        prompt,
        maxOutputTokens: 8,
    };
}
async function waitUntil(check: () => boolean | Promise<boolean>) {
    // Each result is fsynced before completion; CI storage can exceed a 200 ms budget.
    for (let i = 0; i < 300; i++) {
        if (await check()) return;
        await delay(10);
    }
    throw new Error("condition timed out");
}

describe("capabilities", () => {
    it("stays unverified/testing after local success and rejects a stale peer proof", async () => {
        const { daemon } = await fixture();
        expect(daemon.report?.state).toBe("testing");
        expect(daemon.heartbeat()).toBeNull();
        expect(() =>
            daemon.verifyPeer({
                startupId: randomUUID(),
                status: "verified",
                testedAt: new Date().toISOString(),
            }),
        ).toThrow("STALE");
        ready(daemon);
        expect(isReadyCapabilityReport(daemon.report!)).toBe(true);
        expect(daemon.heartbeat()?.sequence).toBe(1);
    });
    it("fails closed on unsupported host, missing model, and changed pin", async () => {
        const runtime = new FakeRuntime();
        const unsupported = await testCapabilities(config, runtime, {
            ...host,
            platform: "linux",
        });
        expect(unsupported.state).toBe("unhealthy");
        expect(runtime.started).toBe(0);
        runtime.fail = true;
        expect((await testCapabilities(config, runtime, host)).state).toBe(
            "unhealthy",
        );
        runtime.fail = false;
        runtime.digest = "wrong";
        expect(
            (await testCapabilities(config, runtime, host)).checks.find(
                (c) => c.name === "model",
            )?.passed,
        ).toBe(false);
    });
    it("invalidates readiness after runtime change and wake gap", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        runtime.version = "other";
        await daemon.health();
        expect(daemon.heartbeat()).toBeNull();
        const old = daemon.report!.startupId;
        runtime.version = config.expectedRuntimeVersion;
        await daemon.retest();
        expect(daemon.report!.startupId).not.toBe(old);
        expect(daemon.report!.peerProbe.status).toBe("unverified");
    });
    it("rejects runtime endpoints that could expose a non-loopback server", () => {
        for (const endpoint of [
            "http://0.0.0.0:1",
            "http://localhost:1",
            "https://127.0.0.1:1",
            "http://u:p@127.0.0.1:1",
        ])
            expect(
                () =>
                    new OllamaRuntime({
                        binary: "/tmp/ollama",
                        modelsPath: "/tmp/models",
                        endpoint,
                    }),
            ).toThrow("loopback");
    });
});
describe("daemon admission and durable lifecycle", () => {
    it("shares one worker across peers, queue depth two, and idempotency", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        runtime.block = true;
        const first = request(),
            second = request(),
            third = request();
        await daemon.submit(first, "buyer-a");
        await daemon.submit(second, "buyer-b");
        await daemon.submit(third, "buyer-c");
        await expect(daemon.submit(request(), "buyer-d")).rejects.toThrow(
            "QUEUE_FULL",
        );
        expect((await daemon.submit(first, "buyer-a")).requestId).toBe(
            first.requestId,
        );
        await expect(
            daemon.submit({ ...first, prompt: "altered" }, "buyer-a"),
        ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
        await expect(daemon.get(first.requestId, "buyer-b")).rejects.toThrow(
            "FORBIDDEN",
        );
        runtime.block = false;
        runtime.complete.shift()?.();
        await waitUntil(
            async () =>
                (await daemon.get(third.requestId, "buyer-c"))?.status ===
                "completed",
        );
        expect(runtime.maxInFlight).toBe(1);
        expect(
            (await daemon.get(first.requestId, "buyer-a"))?.result?.text,
        ).toBe("output:hello");
    });
    it("cancels queue/running work, stops runtime, and requires retest", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        runtime.block = true;
        const running = request(),
            queued = request();
        await daemon.submit(running, "a");
        await daemon.submit(queued, "b");
        expect((await daemon.cancel(queued.requestId, "b"))?.status).toBe(
            "cancelled",
        );
        expect((await daemon.cancel(running.requestId, "a"))?.status).toBe(
            "cancelled",
        );
        await waitUntil(() => runtime.stopped > 0);
        expect(daemon.heartbeat()).toBeNull();
        expect(
            (await daemon.get(running.requestId, "a"))?.result,
        ).toBeUndefined();
    });
    it("pause rejects admissions, draining finishes accepted work, and context guard rejects bytes", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        daemon.pause();
        await expect(daemon.submit(request(), "a")).rejects.toThrow(
            "UNAVAILABLE",
        );
        daemon.resume();
        await expect(
            daemon.submit(request("🙂".repeat(600)), "a"),
        ).rejects.toThrow("CONTEXT_TOO_LARGE");
        runtime.block = true;
        const one = request();
        await daemon.submit(one, "a");
        daemon.drain();
        await expect(daemon.submit(request(), "b")).rejects.toThrow(
            "UNAVAILABLE",
        );
        runtime.block = false;
        runtime.complete.shift()?.();
        await waitUntil(
            async () =>
                (await daemon.get(one.requestId, "a"))?.status === "completed",
        );
        expect((await daemon.cancel(one.requestId, "a"))?.status).toBe(
            "completed",
        );
    });
    it("does not recover live requests as unknown during cleanup", async () => {
        const { daemon, runtime, store } = await fixture();
        ready(daemon);
        runtime.block = true;
        const r = request();
        await daemon.submit(r, "a");
        await store.recoverAndCleanup(false);
        expect((await daemon.get(r.requestId, "a"))?.status).toBe("running");
        await daemon.emergencyStop();
    });
});
describe("storage failure isolation", () => {
    it("stops the owned runtime and fails readiness if terminal persistence fails", async () => {
        const { daemon, runtime, store } = await fixture();
        ready(daemon);
        runtime.block = true;
        const r = request();
        await daemon.submit(r, "a");
        vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));
        runtime.complete.shift()?.();
        await waitUntil(() => runtime.stopped > 0);
        expect(daemon.heartbeat()).toBeNull();
        expect((await daemon.get(r.requestId, "a"))?.status).toBe("unknown");
    });
    it("rejects malformed probe timestamps even when startup identity matches", async () => {
        const { daemon } = await fixture();
        expect(() =>
            daemon.verifyPeer({
                startupId: daemon.report!.startupId,
                status: "verified",
                testedAt: "not-a-date",
            }),
        ).toThrow("STALE_PEER_PROBE");
        expect(daemon.heartbeat()).toBeNull();
    });
});
describe("deadlines and rate authority", () => {
    it("fails timed-out work and never leaves the worker available", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        runtime.block = true;
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const r = request();
        await daemon.submit(r, "a");
        for (let i = 0; i < 20 && !runtime.inFlight; i++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(runtime.inFlight).toBe(1);
        await vi.advanceTimersByTimeAsync(60001);
        vi.useRealTimers();
        await waitUntil(
            async () =>
                (await daemon.get(r.requestId, "a"))?.status === "failed",
        );
        expect((await daemon.get(r.requestId, "a"))?.error).toBe(
            "DEADLINE_EXCEEDED",
        );
        expect(daemon.heartbeat()).toBeNull();
    });
    it("includes metadata inspection within the execution deadline", async () => {
        const { daemon, runtime } = await fixture();
        ready(daemon);
        runtime.info = async (signal?: AbortSignal) => {
            if (!signal)
                return { version: runtime.version, digest: runtime.digest };
            return new Promise((_, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                }),
            );
        };
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const r = request();
        await daemon.submit(r, "a");
        await vi.advanceTimersByTimeAsync(60001);
        vi.useRealTimers();
        await waitUntil(
            async () =>
                (await daemon.get(r.requestId, "a"))?.status === "failed",
        );
        expect((await daemon.get(r.requestId, "a"))?.error).toBe(
            "DEADLINE_EXCEEDED",
        );
    });
    it("rejects negative runtime usage instead of persisting invalid diagnostics", async () => {
        const original = globalThis.fetch;
        globalThis.fetch = async () =>
            new Response(
                JSON.stringify({
                    done: true,
                    response: "text",
                    prompt_eval_count: -1,
                    eval_count: 1,
                }),
            );
        try {
            const runtime = new OllamaRuntime({
                binary: "/tmp/unused",
                modelsPath: "/tmp/models",
                endpoint: "http://127.0.0.1:11536",
            });
            await expect(
                runtime.generate("hello", 8, new AbortController().signal),
            ).rejects.toThrow("Invalid");
        } finally {
            globalThis.fetch = original;
        }
    });
    it.each([
        ["stop", "stop"],
        ["length", "length"],
        ["unsupported", "unknown"],
        [undefined, "unknown"],
    ])(
        "preserves actual generation finish reason %s as %s",
        async (reason, expected) => {
            const original = globalThis.fetch;
            globalThis.fetch = async () =>
                new Response(
                    JSON.stringify({
                        done: true,
                        response: "text",
                        prompt_eval_count: 1,
                        eval_count: 1,
                        done_reason: reason,
                    }),
                );
            try {
                const runtime = new OllamaRuntime({
                    binary: "/tmp/unused",
                    modelsPath: "/tmp/models",
                    endpoint: "http://127.0.0.1:11536",
                });
                expect(
                    (
                        await runtime.generate(
                            "hello",
                            8,
                            new AbortController().signal,
                        )
                    ).finishReason,
                ).toBe(expected);
            } finally {
                globalThis.fetch = original;
            }
        },
    );
    it("restores legacy buyer windows conservatively and excludes explicitly declined records", async () => {
        const f = await fixture();
        for (let i = 0; i < 6; i++) {
            const base = {
                requestId: randomUUID(),
                buyerKeyId: "legacy",
                fingerprint: "component-fixture",
                status: "failed" as const,
                updatedAt: Date.now(),
            };
            await f.store.save(base);
            await f.store.save({
                ...base,
                requestId: randomUUID(),
                buyerKeyId: "declined",
                admittedAt: null,
            });
        }
        const restarted = new ProviderDaemon(
            f.daemon.config,
            f.runtime,
            f.store,
            f.daemon.host,
        );
        await restarted.launch();
        ready(restarted);
        await expect(restarted.submit(request(), "legacy")).rejects.toThrow(
            "RATE_LIMITED",
        );
        const accepted = request();
        await restarted.submit(accepted, "declined");
        await waitUntil(
            async () =>
                (await restarted.get(accepted.requestId, "declined"))
                    ?.status === "completed",
        );
        await restarted.cancel(accepted.requestId, "declined");
    });
    it("limits accepted buyer requests and retests after a wake gap", async () => {
        const { daemon } = await fixture();
        ready(daemon);
        for (let i = 0; i < 6; i++) {
            const r = request();
            await daemon.submit(r, "a");
            await waitUntil(
                async () =>
                    (await daemon.get(r.requestId, "a"))?.status ===
                    "completed",
            );
        }
        await expect(daemon.submit(request(), "a")).rejects.toThrow(
            "RATE_LIMITED",
        );
        const previous = daemon.report!.startupId;
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 46000);
        await daemon.health();
        expect(daemon.report!.startupId).not.toBe(previous);
        expect(daemon.report!.peerProbe.status).toBe("unverified");
    });
});
describe("encrypted retention and recovery", () => {
    it("encrypts durable results, recovers uncertain work, and removes expired results", async () => {
        const path = await mkdtemp(join(tmpdir(), "panas-store-"));
        directories.push(path);
        let now = Date.now();
        const store = new EncryptedStore(path, () => now);
        await store.init();
        const id = randomUUID();
        await store.save({
            requestId: id,
            buyerKeyId: "a",
            fingerprint: "digest",
            status: "completed",
            updatedAt: now,
            result: {
                text: "private result",
                inputTokens: 1,
                outputTokens: 1,
                durationMs: 1,
            },
        });
        expect(
            (await readFile(join(path, `${id}.enc`))).toString(),
        ).not.toContain("private result");
        expect((await stat(join(path, "key"))).mode & 0o777).toBe(0o600);
        const restarted = new EncryptedStore(path, () => now);
        await restarted.init();
        expect((await restarted.get(id))?.result?.text).toBe("private result");
        now += 2 * 86400000;
        await restarted.recoverAndCleanup();
        expect((await restarted.get(id))?.result).toBeUndefined();
        now += 30 * 86400000;
        await restarted.recoverAndCleanup();
        expect(
            (await readdir(path)).filter((f) => f.endsWith(".enc")),
        ).toHaveLength(0);
    });
    it("marks interrupted requests unknown instead of executing them again", async () => {
        const { store } = await fixture();
        const id = randomUUID();
        await store.save({
            requestId: id,
            buyerKeyId: "a",
            fingerprint: "f",
            status: "running",
            updatedAt: Date.now(),
        });
        await store.recoverAndCleanup();
        expect((await store.get(id))?.status).toBe("unknown");
    });
});
describe("private IPC", () => {
    it("requires private token on a permission-restricted Unix socket", async () => {
        const { daemon, path } = await fixture();
        const socketPath = join(path, "daemon.sock"),
            server = await serveLocal(daemon, socketPath, "secret-token");
        const call = (token: string) =>
            new Promise<string>((resolve, reject) => {
                const s = createConnection(socketPath);
                let response = "";
                s.on("connect", () =>
                    s.write(JSON.stringify({ token, method: "status" }) + "\n"),
                );
                s.on("data", (d) => (response += d.toString()));
                s.on("end", () => resolve(response));
                s.on("error", reject);
            });
        try {
            expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
            expect(JSON.parse(await call("wrong")).ok).toBe(false);
            expect(
                JSON.parse(await call("secret-token")).result.peerProbe.status,
            ).toBe("unverified");
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
