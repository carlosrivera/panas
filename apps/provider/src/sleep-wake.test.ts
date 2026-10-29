import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderDaemon } from "./daemon.js";
import { EncryptedStore } from "./store.js";
import type { RequestHooks } from "./hooks.js";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((path) => rm(path, { recursive: true, force: true })),
    );
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
async function fixture(hooks: RequestHooks = {}) {
    const path = await mkdtemp(join(tmpdir(), "panas-wake-"));
    directories.push(path);
    const clock = { now: Date.now() };
    const config = {
        providerId: randomUUID(),
        dataPath: path,
        expectedDigest: "a".repeat(64),
        expectedRuntimeVersion: "0.40.12",
    };
    const result = {
        text: "fixture",
        inputTokens: 4,
        outputTokens: 4,
        durationMs: 10,
    };
    const runtime = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        info: vi.fn(async () => ({
            digest: config.expectedDigest,
            version: config.expectedRuntimeVersion,
        })),
        cancellationCheck: vi.fn(async () => true),
        generate: vi.fn(async () => result),
    };
    const store = new EncryptedStore(path, () => clock.now);
    const daemon = new ProviderDaemon(
        config,
        runtime,
        store,
        async () => ({
            platform: "darwin",
            architecture: "arm64",
            osMajor: 14,
            memoryBytes: 8 * 1024 ** 3,
            freeDiskBytes: 4 * 1024 ** 3,
        }),
        () => clock.now,
        hooks,
    );
    await daemon.launch();
    const ready = () =>
        daemon.verifyPeer({
            startupId: daemon.report!.startupId,
            status: "verified",
            testedAt: new Date(clock.now).toISOString(),
        });
    ready();
    return { path, clock, result, runtime, store, daemon, ready };
}
const request = () => ({
    requestId: randomUUID(),
    quoteId: randomUUID(),
    prompt: "fixture",
    maxOutputTokens: 8,
});
async function until(check: () => Promise<boolean> | boolean) {
    for (let i = 0; i < 300; i++) {
        if (await check()) return;
        await delay(5);
    }
    throw new Error("Fixture did not finish");
}

it("rejects a late native completion before the wake pulse, drains accepted work, and retains completed bytes/outbox", async () => {
    const f = await fixture({
        terminalEvent: (record) => ({
            componentFixture: true,
            outcome: record.status,
        }),
    });
    const previous = request();
    await f.daemon.submit(previous, "buyer");
    await until(
        async () =>
            (await f.daemon.get(previous.requestId, "buyer"))?.status ===
            "completed",
    );
    const bytes = await readFile(join(f.path, `${previous.requestId}.enc`));
    const native = deferred<typeof f.result>();
    f.runtime.generate.mockImplementationOnce(() => native.promise); // Deliberately ignores abort.
    const work = [request(), request(), request()];
    for (const input of work)
        await f.daemon.submit(input, "buyer", { componentFixture: true });
    await until(() => f.runtime.generate.mock.calls.length === 4);
    const startup = f.daemon.report!.startupId;
    f.clock.now += 46000;
    native.resolve(f.result); // No timer or health callback has run since the clock jump.
    await until(
        async () =>
            (await f.daemon.get(work[2]!.requestId, "buyer"))?.status ===
            "failed",
    );
    expect((await f.daemon.get(work[0]!.requestId, "buyer"))?.error).toBe(
        "PROVIDER_SUSPENDED",
    );
    expect((await f.daemon.pendingTerminals()).map((r) => r.status)).toEqual([
        "failed",
        "failed",
        "failed",
    ]);
    expect(await readFile(join(f.path, `${previous.requestId}.enc`))).toEqual(
        bytes,
    );
    expect(f.runtime.generate).toHaveBeenCalledTimes(4);
    await f.daemon.health();
    expect(f.daemon.report!.startupId).not.toBe(startup);
    expect(f.daemon.status?.state).toBe("testing");
    await expect(f.daemon.submit(request(), "buyer")).rejects.toThrow(
        "PROVIDER_UNAVAILABLE",
    );
    await f.daemon.submit(work[0], "buyer", { componentFixture: true });
    expect(f.runtime.generate).toHaveBeenCalledTimes(6); // Only two new capability smoke calls.
    f.ready();
    expect(f.daemon.status?.state).toBe("ready");
});

it("uses the absolute execution deadline when the timer callback has not run", async () => {
    const f = await fixture({ timeoutMs: () => 10000 });
    const native = deferred<typeof f.result>();
    f.runtime.generate.mockImplementationOnce(() => native.promise);
    const input = request();
    await f.daemon.submit(input, "buyer");
    await until(() => f.runtime.generate.mock.calls.length === 3);
    f.clock.now += 10001; // Below the liveness TTL, above the signed execution limit.
    native.resolve(f.result);
    await until(
        async () =>
            (await f.daemon.get(input.requestId, "buyer"))?.status === "failed",
    );
    expect((await f.daemon.get(input.requestId, "buyer"))?.error).toBe(
        "DEADLINE_EXCEEDED",
    );
});

it("drains paused accepted work and keeps later queued work recoverable after a persistence failure", async () => {
    const f = await fixture();
    const native = deferred<typeof f.result>();
    f.runtime.generate.mockImplementationOnce(() => native.promise);
    const work = [request(), request(), request()];
    for (const input of work) await f.daemon.submit(input, "buyer");
    await until(() => f.runtime.generate.mock.calls.length === 3);
    f.daemon.pause();
    native.resolve(f.result);
    await until(
        async () =>
            (await f.daemon.get(work[0]!.requestId, "buyer"))?.status ===
            "completed",
    );
    // Let the active worker finish cleanup while accepted queued work remains paused.
    await delay(5);
    const save = f.store.save.bind(f.store);
    vi.spyOn(f.store, "save").mockImplementation(async (record) => {
        if (
            record.requestId === work[1]!.requestId &&
            record.status === "failed"
        )
            throw new Error("Injected disk failure");
        return save(record);
    });
    f.clock.now += 46000;
    await expect(f.daemon.health()).rejects.toThrow("PERSISTENCE_UNCERTAIN");
    expect((await f.daemon.get(work[1]!.requestId, "buyer"))?.status).toBe(
        "unknown",
    );
    f.daemon.resume();
    await f.daemon.health();
    expect((await f.daemon.get(work[2]!.requestId, "buyer"))?.status).toBe(
        "failed",
    );
    expect(f.runtime.generate).toHaveBeenCalledTimes(5); // Original work plus capability tests only.
});

it("stops before generation if authorization resumes after a liveness gap", async () => {
    const authorization = deferred<void>();
    const beforeExecute = vi.fn(() => authorization.promise);
    const f = await fixture({ beforeExecute });
    const input = request();
    await f.daemon.submit(input, "buyer");
    await until(() => beforeExecute.mock.calls.length === 1);
    f.clock.now += 46000;
    authorization.resolve();
    await until(
        async () =>
            (await f.daemon.get(input.requestId, "buyer"))?.status === "failed",
    );
    expect(f.runtime.generate).toHaveBeenCalledTimes(2);
});

it.each(["pause", "drain"] as const)(
    "preserves owner %s across wake and requires a new peer proof",
    async (mode) => {
        const f = await fixture();
        f.daemon[mode]();
        const startup = f.daemon.report!.startupId;
        f.clock.now += 46000;
        await f.daemon.health();
        expect(f.daemon.report!.startupId).not.toBe(startup);
        expect(f.daemon.report!.peerProbe.status).toBe("unverified");
        f.ready();
        expect(f.daemon.status?.state).toBe(
            mode === "pause" ? "paused" : "draining",
        );
        await expect(f.daemon.submit(request(), "buyer")).rejects.toThrow(
            "PROVIDER_UNAVAILABLE",
        );
    },
);

it("invalidates on backward clock movement and refuses the old peer proof", async () => {
    const f = await fixture();
    const old = f.daemon.report!;
    f.clock.now -= 1000;
    expect(f.daemon.heartbeat()).toBeNull();
    expect(f.runtime.stop).toHaveBeenCalled();
    expect(() =>
        f.daemon.verifyPeer({
            startupId: old.startupId,
            status: "verified",
            testedAt: old.testedAt,
        }),
    ).toThrow("STALE_PEER_PROBE");
});

it("discards capability evidence spanning a gap and allows responsive long tests", async () => {
    const f = await fixture();
    const native = deferred<typeof f.result>();
    f.runtime.generate.mockImplementationOnce(() => native.promise);
    const testing = f.daemon.retest();
    await until(() => f.runtime.generate.mock.calls.length === 3);
    f.clock.now += 46000;
    native.resolve(f.result);
    await testing;
    expect(f.daemon.status?.state).toBe("unhealthy");
    await f.daemon.health();
    const responsive = deferred<typeof f.result>();
    f.runtime.generate.mockImplementationOnce(() => responsive.promise);
    const fresh = f.daemon.retest();
    await until(() => f.runtime.generate.mock.calls.length === 7);
    for (let i = 0; i < 5; i++) {
        f.clock.now += 15000;
        f.daemon.observeLiveness(); // Host pulse remains responsive during a slow load.
    }
    responsive.resolve(f.result);
    await fresh;
    expect(f.daemon.status?.state).toBe("testing");
});
