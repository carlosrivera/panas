import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderDaemon, EncryptedStore } from "@panas/provider";
import { probePeer, superviseShare } from "@panas/mcpwire";
import { verifyProviderProof } from "../../../packages/registry/src/auth.js";
import { ProviderController } from "./controller.js";
import type { ProviderHostService } from "./service.js";

vi.mock("@panas/mcpwire", () => ({
    probePeer: vi.fn(),
    superviseShare: vi.fn(),
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
async function until(check: () => boolean) {
    for (let i = 0; i < 300; i++) {
        if (check()) return;
        await delay(5);
    }
    throw new Error("Controller fixture did not reach boundary");
}
async function fixture() {
    const path = await mkdtemp(join(tmpdir(), "panas-controller-wake-"));
    cleanups.push(() => rm(path, { recursive: true, force: true }));
    const clock = { now: Date.now() };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const keys = generateKeyPairSync("ed25519");
    const config = {
        providerId: randomUUID(),
        dataPath: path,
        expectedDigest: "a".repeat(64),
        expectedRuntimeVersion: "0.40.12",
    };
    const runtime = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        info: vi.fn(async () => ({
            digest: config.expectedDigest,
            version: config.expectedRuntimeVersion,
            sandbox: "docker-worker" as const,
        })),
        cancellationCheck: vi.fn(async () => true),
        generate: vi.fn(async () => ({
            text: "fixture",
            inputTokens: 4,
            outputTokens: 4,
            durationMs: 10,
        })),
    };
    const daemon = new ProviderDaemon(
        config,
        runtime,
        new EncryptedStore(path),
        async () => ({
            platform: "linux",
            sandbox: "docker",
            architecture: "arm64",
            osMajor: 14,
            memoryBytes: 8 * 1024 ** 3,
            freeDiskBytes: 4 * 1024 ** 3,
        }),
    );
    await daemon.launch();
    const shares: { stop: ReturnType<typeof vi.fn> }[] = [];
    vi.mocked(superviseShare).mockImplementation(() => {
        const closed = deferred<unknown>();
        const session = {
            ready: Promise.resolve({
                kind: "ready",
                ticket: "component-fixture-only",
            }),
            closed: closed.promise,
            stop: vi.fn(async () => {
                closed.resolve({ kind: "closed" });
            }),
        };
        shares.push(session);
        return session as unknown as ReturnType<typeof superviseShare>;
    });
    const evidence = (startupId: string) => ({
        startupId,
        testedAt: new Date(clock.now).toISOString(),
        status: "verified" as const,
        evidence: "separate-process-local-peer" as const,
        detail: "Mocked transport boundary; not hardware evidence",
    });
    vi.mocked(probePeer).mockImplementation(async ({ startupId }) =>
        evidence(startupId),
    );
    const response = (post: { body: Record<string, unknown> }) => {
        const report = post.body.report as
            { startupId: string; state: string; sequence: number } | undefined;
        return Response.json({
            providerId: config.providerId,
            startupId: report?.startupId ?? post.body.startupId,
            state: report?.state ?? post.body.state,
            sequence: report?.sequence,
            expiresAt: new Date(clock.now + 45000).toISOString(),
            reportDigest: "a".repeat(64),
        });
    };
    const publication = vi.fn(async (post: { body: Record<string, unknown> }) =>
        response(post),
    );
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL, init: RequestInit) => {
            posts.push({
                path: url.pathname.replace(/^\/registry/, ""),
                body: JSON.parse(String(init.body)) as Record<string, unknown>,
            });
            expect(url.pathname.startsWith("/registry/")).toBe(true);
            const headers = new Headers(init.headers);
            verifyProviderProof(
                {
                    providerId: config.providerId,
                    publicKeyPem: keys.publicKey
                        .export({ type: "spki", format: "pem" })
                        .toString(),
                    enabled: true,
                },
                {
                    providerId: headers.get("x-panas-provider-id")!,
                    timestamp: headers.get("x-panas-timestamp")!,
                    nonce: headers.get("x-panas-nonce")!,
                    signature: headers.get("x-panas-signature")!,
                },
                posts.at(-1)!.path,
                String(init.body),
                new Date(clock.now),
            );
            return publication(posts.at(-1)!);
        }),
    );
    const accounting = {
        authorize: vi.fn(async () => {}),
        terminal: vi.fn(async () => {}),
        descriptor: vi.fn(async (_body: Record<string, unknown>) => {}),
    };
    const controller = new ProviderController(
        {
            registryUrl: "http://127.0.0.1:1/registry",
            providerId: config.providerId,
            privateKey: keys.privateKey,
            providerPublicKeyPem: keys.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            price: {
                currency: "TEST_CREDIT",
                totalAtomic: "100",
                version: "prototype-v1",
            },
        },
        daemon,
        {
            flushTerminals: vi.fn(async () => {}),
        } as unknown as ProviderHostService,
        accounting,
    );
    cleanups.push(() => controller.stop());
    return {
        clock,
        daemon,
        controller,
        shares,
        posts,
        accounting,
        publication,
        evidence,
        runtime,
        response,
    };
}

it.each(["probe", "register", "descriptor"] as const)(
    "retires the share during an in-flight %s and rejects its late publication",
    async (phase) => {
        const f = await fixture();
        const startup = f.daemon.report!.startupId;
        let resume!: () => void;
        if (phase === "probe") {
            const boundary = deferred<Awaited<ReturnType<typeof probePeer>>>();
            vi.mocked(probePeer).mockImplementationOnce(() => boundary.promise);
            resume = () => boundary.resolve(f.evidence(startup));
        } else if (phase === "register") {
            const boundary = deferred<Response>();
            f.publication.mockImplementationOnce(() => boundary.promise);
            resume = () => boundary.resolve(f.response(f.posts[0]!));
        } else {
            const boundary = deferred<void>();
            f.accounting.descriptor.mockImplementationOnce(
                () => boundary.promise,
            );
            resume = () => boundary.resolve();
        }
        const pending = f.controller.tick();
        await until(() =>
            phase === "probe"
                ? vi.mocked(probePeer).mock.calls.length === 1
                : phase === "register"
                  ? f.posts.length === 1
                  : f.accounting.descriptor.mock.calls.length === 1,
        );
        f.clock.now += 46000;
        await f.controller.tick(); // Locked controller still retires the stale share immediately.
        expect(f.shares[0]!.stop).toHaveBeenCalledTimes(1);
        resume();
        await pending;
        expect(
            f.posts.filter((p) => p.path.endsWith("heartbeat")),
        ).toHaveLength(0);
        if (phase !== "descriptor")
            expect(f.accounting.descriptor).not.toHaveBeenCalled();
        await f.controller.tick();
        expect(f.daemon.report!.startupId).not.toBe(startup);
        expect(f.daemon.status?.state).toBe("ready");
        expect(f.accounting.descriptor.mock.lastCall![0].startupId).toBe(
            f.daemon.report!.startupId,
        );
        expect(
            f.posts.filter((p) => p.path.endsWith("heartbeat")),
        ).toHaveLength(1);
    },
);

it.each(["pause", "drain"] as const)(
    "keeps owner %s during descriptor rotation and probes the new share",
    async (mode) => {
        const f = await fixture();
        await f.controller.tick();
        const startup = f.daemon.report!.startupId;
        f.daemon[mode]();
        for (let i = 0; i < 220; i++) {
            f.clock.now += 15000;
            f.daemon.observeLiveness();
            f.daemon.heartbeat();
        }
        await f.controller.tick();
        expect(f.daemon.report!.startupId).not.toBe(startup);
        expect(f.daemon.status?.state).toBe(
            mode === "pause" ? "paused" : "draining",
        );
        expect(f.daemon.report!.peerProbe.status).toBe("verified");
        expect(f.shares).toHaveLength(2);
        const registrations = f.posts.filter((p) =>
            p.path.endsWith("register"),
        );
        expect(
            (registrations.at(-1)!.body.report as { state: string }).state,
        ).toBe(mode === "pause" ? "paused" : "draining");
    },
);

it("stages discovery until accounting acknowledges its descriptor and retries without another capability run", async () => {
    const f = await fixture();
    f.accounting.descriptor.mockRejectedValueOnce(new Error("offline"));
    await f.controller.tick();
    expect(f.daemon.status?.state).toBe("draining");
    expect(
        f.posts.map((p) => (p.body.report as { state?: string })?.state),
    ).toEqual(["testing"]);
    expect(f.shares[0]!.stop).not.toHaveBeenCalled();
    await expect(
        f.daemon.submit(
            {
                requestId: randomUUID(),
                quoteId: randomUUID(),
                prompt: "fixture",
                maxOutputTokens: 8,
            },
            "buyer",
        ),
    ).rejects.toThrow("PROVIDER_UNAVAILABLE");
    await f.controller.tick();
    expect(f.accounting.descriptor).toHaveBeenCalledTimes(1); // Backoff prevents immediate retry.
    f.clock.now += 15000;
    await f.controller.tick();
    expect(f.daemon.status?.state).toBe("ready");
    expect(f.runtime.generate).toHaveBeenCalledTimes(2);
    expect(f.shares).toHaveLength(1);
});

it("retries the exact final registration after a lost acknowledgement", async () => {
    const f = await fixture();
    let lost = false;
    f.publication.mockImplementation(async (post) => {
        if (
            (post.body.report as { state?: string })?.state === "ready" &&
            !lost
        ) {
            lost = true;
            throw new Error("Commit observed by fixture server; reply lost");
        }
        return f.response(post);
    });
    await f.controller.tick();
    const first = f.posts[1]!.body;
    expect(f.daemon.status?.state).toBe("draining");
    f.clock.now += 15000;
    await f.controller.tick();
    expect(f.posts[2]!.body).toEqual(first);
    expect(f.daemon.status?.state).toBe("ready");
    expect(f.runtime.generate).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
    "keeps accepted active work bounded through a registry outage, expired lease=%s",
    async (expire) => {
        const f = await fixture();
        await f.controller.tick();
        const startup = f.daemon.report!.startupId;
        const result = {
            text: "fixture",
            inputTokens: 4,
            outputTokens: 4,
            durationMs: 10,
        };
        const native = deferred<typeof result>();
        f.runtime.generate.mockImplementationOnce(() => native.promise);
        const work = [0, 1, 2].map(() => ({
            requestId: randomUUID(),
            quoteId: randomUUID(),
            prompt: "fixture",
            maxOutputTokens: 8,
        }));
        for (const request of work) await f.daemon.submit(request, "buyer");
        await until(() => f.runtime.generate.mock.calls.length === 3);
        f.publication.mockRejectedValue(new Error("offline"));
        await f.controller.tick();
        expect(f.daemon.status?.state).toBe("draining");
        expect(f.daemon.localStatus?.state).toBe("busy");
        expect(f.runtime.stop).not.toHaveBeenCalled();
        expect((await f.daemon.get(work[1]!.requestId, "buyer"))?.status).toBe(
            "failed",
        );
        expect((await f.daemon.get(work[2]!.requestId, "buyer"))?.status).toBe(
            "failed",
        );
        const pulses = expire ? 3 : 1;
        if (!expire)
            f.publication.mockImplementation(async (post) => f.response(post));
        for (let i = 0; i < pulses; i++) {
            f.clock.now += 15000;
            await f.controller.tick();
        }
        expect(f.runtime.stop).not.toHaveBeenCalled();
        expect(f.shares[0]!.stop).not.toHaveBeenCalled();
        native.resolve(result);
        for (let i = 0; i < 300; i++) {
            if (
                (await f.daemon.get(work[0]!.requestId, "buyer"))?.status ===
                "completed"
            )
                break;
            await delay(5);
        }
        await f.daemon.cancel(work[0]!.requestId, "buyer");
        f.publication.mockImplementation(async (post) => f.response(post));
        f.clock.now += 15000;
        await f.controller.tick();
        expect(f.daemon.status?.state).toBe("ready");
        expect(f.daemon.report!.startupId === startup).toBe(!expire);
        expect(f.runtime.generate).toHaveBeenCalledTimes(expire ? 5 : 3);
        expect((await f.daemon.get(work[0]!.requestId, "buyer"))?.status).toBe(
            "completed",
        );
    },
);

it("rejects a malformed HTTP200 heartbeat acknowledgement", async () => {
    const f = await fixture();
    await f.controller.tick();
    f.publication.mockResolvedValueOnce(Response.json({}));
    await f.controller.tick();
    expect(f.daemon.status?.state).toBe("draining");
    expect(f.shares[0]!.stop).not.toHaveBeenCalled();
});
