import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serveLocal } from "@panas/provider";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { prototypeLimits } from "@panas/contracts";
import {
    DOMAIN,
    digest,
    keyId,
    signDocument,
    verifyDocument,
    grantSchema,
    operationSchema,
    providerResultSchema,
    signedTerminalEventSchema,
    type Grant,
    type HostOperation,
    type SignedDocument,
    type TerminalEvent,
} from "@panas/protocol";
import {
    EncryptedStore,
    ProviderDaemon,
    type Generation,
    type InferenceRuntime,
} from "@panas/provider";
import { ProviderHostService } from "./service.js";
import type { AccountingPort } from "./accounting-client.js";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(
        dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
    );
});
const pem = (pair: ReturnType<typeof generateKeyPairSync>) =>
    pair.publicKey.export({ type: "spki", format: "pem" }).toString();
class Runtime implements InferenceRuntime {
    calls = 0;
    block = false;
    release: (() => void) | undefined;
    async start() {}
    async stop() {}
    async info() {
        return { version: "0.40.12", digest: "a".repeat(64) };
    }
    async cancellationCheck() {
        return true;
    }
    async generate(
        prompt: string,
        maxOutput: number,
        signal: AbortSignal,
    ): Promise<Generation> {
        this.calls++;
        if (this.block)
            await new Promise<void>((resolve, reject) => {
                this.release = resolve;
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
            });
        return {
            text: `answer:${prompt}`,
            inputTokens: 4,
            outputTokens: Math.min(4, maxOutput),
            durationMs: 1,
        };
    }
}
class Accounting implements AccountingPort {
    active = true;
    unavailable = false;
    authorized = 0;
    events: SignedDocument<TerminalEvent>[] = [];
    async authorize() {
        if (!this.active) throw new Error("not reserved");
        this.authorized++;
    }
    async terminal(event: SignedDocument<TerminalEvent>) {
        if (this.unavailable) throw new Error("offline");
        this.events.push(event);
    }
    async descriptor() {}
}
async function fixture() {
    const path = await mkdtemp(join(tmpdir(), "panas-host-"));
    dirs.push(path);
    const platform = generateKeyPairSync("ed25519"),
        provider = generateKeyPairSync("ed25519"),
        buyer = generateKeyPairSync("ed25519");
    const providerId = randomUUID(),
        runtime = new Runtime(),
        accounting = new Accounting();
    const config = {
        providerId,
        expectedDigest: "a".repeat(64),
        expectedRuntimeVersion: "0.40.12",
        dataPath: path,
    };
    const identity = {
        providerId,
        providerPrivateKey: provider.privateKey,
        platformPublicKey: platform.publicKey,
    };
    let service: ProviderHostService, daemon: ProviderDaemon;
    async function restart() {
        service = new ProviderHostService(
            identity,
            new EncryptedStore(join(path, "nonces")),
            accounting,
        );
        daemon = new ProviderDaemon(
            config,
            runtime,
            new EncryptedStore(join(path, "requests")),
            async () => ({
                platform: "darwin",
                architecture: "arm64",
                osMajor: 27,
                memoryBytes: 8 * 1024 ** 3,
                freeDiskBytes: 4 * 1024 ** 3,
            }),
            () => Date.now(),
            service.hooks,
        );
        service.bind(daemon);
        await daemon.launch();
        await service.init();
        daemon.verifyPeer({
            startupId: daemon.report!.startupId,
            status: "verified",
            testedAt: new Date().toISOString(),
        });
        return { service, daemon };
    }
    const initial = await restart();
    const payload = { prompt: "hello", maxOutputTokens: 8 };
    const now = Date.now();
    const grant = grantSchema.parse({
        version: 1,
        quoteId: randomUUID(),
        requestId: randomUUID(),
        buyerId: randomUUID(),
        sessionId: randomUUID(),
        buyerKeyId: keyId(buyer.publicKey),
        buyerPublicKeyPem: pem(buyer),
        providerId,
        providerKeyId: keyId(provider.publicKey),
        providerPublicKeyPem: pem(provider),
        startupId: initial.daemon.report!.startupId,
        modelDigest: "a".repeat(64),
        priceVersion: "1",
        totalAtomic: "10",
        providerAtomic: "9",
        feeAtomic: "1",
        currency: "TEST_CREDIT",
        limits: prototypeLimits,
        payloadDigest: digest(payload),
        failurePolicy: "no_charge_failed_or_cancelled",
        cancellationPolicy: "provider_terminal_decision",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 86400000).toISOString(),
        executeBefore: new Date(now + 60000).toISOString(),
        grantId: randomUUID(),
        reservationId: randomUUID(),
        operations: ["run_inference", "get_request", "cancel_request"],
    });
    function wire(
        operation: HostOperation = "run_inference",
        g: Grant = grant,
        body: unknown = operation === "run_inference" ? payload : {},
    ) {
        const issued = Date.now();
        const proof = operationSchema.parse({
            version: 1,
            grantId: g.grantId,
            requestId: g.requestId,
            operation,
            nonce: randomUUID(),
            payloadDigest: digest(body),
            issuedAt: new Date(issued).toISOString(),
            expiresAt: new Date(issued + 60000).toISOString(),
        });
        return {
            proof: signDocument(DOMAIN.operation, proof, buyer.privateKey),
            grant: signDocument(DOMAIN.grant, g, platform.privateKey),
            payload: body,
        };
    }
    return {
        ...initial,
        platform,
        provider,
        buyer,
        grant,
        payload,
        wire,
        runtime,
        accounting,
        restart,
        path,
    };
}
async function waitUntil(check: () => Promise<boolean>) {
    for (let i = 0; i < 100; i++) {
        if (await check()) return;
        await delay(2);
    }
    throw new Error("timeout");
}

describe("provider authentication", () => {
    it("accepts exact signed bindings and signs response for the expected operation nonce", async () => {
        const f = await fixture(),
            wire = f.wire();
        const response = providerResultSchema.parse(
            await f.service.handle({ tool: "run_inference", request: wire }),
        );
        expect(
            verifyDocument(
                DOMAIN.response,
                response.proof,
                f.provider.publicKey,
            ),
        ).toBe(true);
        expect(response.proof.payload.nonce).toBe(wire.proof.payload.nonce);
        expect(response.proof.payload.resultDigest).toBe(digest(response.body));
        await waitUntil(
            async () =>
                (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                    ?.status === "completed",
        );
        expect(f.accounting.authorized).toBe(1);
        const record = await f.daemon.get(
                f.grant.requestId,
                f.grant.buyerKeyId,
            ),
            event = signedTerminalEventSchema.parse(record?.terminalEvent);
        expect(
            verifyDocument(DOMAIN.terminal, event, f.provider.publicKey),
        ).toBe(true);
        expect(event.payload.outcome).toBe("completed");
        expect(JSON.stringify(event)).not.toContain("answer:hello");
    });
    it("rejects ticket-only, wrong platform, wrong buyer, altered payload, stale startup and wrong provider", async () => {
        const f = await fixture();
        const baseline = f.runtime.calls;
        const invalid = [
            {},
            {
                ...f.wire(),
                grant: signDocument(
                    DOMAIN.grant,
                    f.grant,
                    generateKeyPairSync("ed25519").privateKey,
                ),
            },
            {
                ...f.wire(),
                proof: signDocument(
                    DOMAIN.operation,
                    f.wire().proof.payload,
                    generateKeyPairSync("ed25519").privateKey,
                ),
            },
            { ...f.wire(), payload: { ...f.payload, prompt: "altered" } },
            f.wire("run_inference", { ...f.grant, startupId: randomUUID() }),
            f.wire("run_inference", { ...f.grant, providerId: randomUUID() }),
        ];
        for (const request of invalid)
            await expect(
                f.service.handle({ tool: "run_inference", request }),
            ).rejects.toThrow();
        expect(f.runtime.calls).toBe(baseline);
        expect(f.accounting.authorized).toBe(0);
    });
    it("rejects expiry, operation substitution, model change, limit overflow, and proof replay durably", async () => {
        const f = await fixture();
        await expect(
            f.service.handle({
                tool: "run_inference",
                request: f.wire("run_inference", {
                    ...f.grant,
                    expiresAt: new Date(Date.now() - 1).toISOString(),
                    issuedAt: new Date(Date.now() - 120000).toISOString(),
                    executeBefore: new Date(Date.now() - 1000).toISOString(),
                }),
            }),
        ).rejects.toThrow();
        await expect(
            f.service.handle({ tool: "cancel_request", request: f.wire() }),
        ).rejects.toThrow();
        await expect(
            f.service.handle({
                tool: "run_inference",
                request: f.wire("run_inference", {
                    ...f.grant,
                    modelDigest: "b".repeat(64),
                }),
            }),
        ).rejects.toThrow();
        await expect(
            f.service.handle({
                tool: "run_inference",
                request: f.wire("run_inference", {
                    ...f.grant,
                    requestId: randomUUID(),
                    quoteId: randomUUID(),
                    reservationId: randomUUID(),
                    grantId: randomUUID(),
                    limits: { ...prototypeLimits, maxOutputTokens: 1 },
                }),
            }),
        ).rejects.toThrow();
        const wire = f.wire();
        await f.service.handle({ tool: "run_inference", request: wire });
        await expect(
            f.service.handle({ tool: "run_inference", request: wire }),
        ).rejects.toThrow("REPLAYED");
        await waitUntil(
            async () =>
                (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                    ?.status === "completed",
        );
        const retrieval = f.wire("get_request");
        await f.service.handle({ tool: "get_request", request: retrieval });
        const restarted = await f.restart();
        await expect(
            restarted.service.handle({
                tool: "get_request",
                request: retrieval,
            }),
        ).rejects.toThrow("REPLAYED_OPERATION");
        await expect(
            restarted.service.handle({ tool: "run_inference", request: wire }),
        ).rejects.toThrow();
        // A fresh retrieval proof survives daemon restart while run always requires the current startup.
        const refreshed = {
            ...f.grant,
            operations: ["get_request", "cancel_request"] as HostOperation[],
        };
        const result = providerResultSchema.parse(
            await restarted.service.handle({
                tool: "get_request",
                request: f.wire("get_request", refreshed),
            }),
        );
        expect((result.body as { status: string }).status).toBe("completed");
    });
    it("requires a live reserved authorization before executing any model work", async () => {
        const f = await fixture();
        f.accounting.active = false;
        const calls = f.runtime.calls;
        await f.service.handle({ tool: "run_inference", request: f.wire() });
        await waitUntil(
            async () =>
                (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                    ?.status === "failed",
        );
        expect(f.runtime.calls).toBe(calls);
        expect(
            (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                ?.terminalEvent,
        ).toBeTruthy();
    });
    it("retains a signed terminal outbox across adapter/service loss and retries idempotently", async () => {
        const f = await fixture();
        f.accounting.unavailable = true;
        await f.service.handle({ tool: "run_inference", request: f.wire() });
        await waitUntil(
            async () =>
                (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                    ?.status === "completed",
        );
        const before = signedTerminalEventSchema.parse(
            (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                ?.terminalEvent,
        );
        await expect(f.service.flushTerminals()).rejects.toThrow("offline");
        const restarted = await f.restart();
        f.accounting.unavailable = false;
        await restarted.service.flushTerminals();
        await restarted.service.flushTerminals();
        expect(f.accounting.events).toHaveLength(1);
        expect(f.accounting.events[0]?.payload.eventId).toBe(
            before.payload.eventId,
        );
        expect(
            (await restarted.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                ?.terminalDelivered,
        ).toBe(true);
    });
    it("signs durable cancellation but never releases accounting directly", async () => {
        const f = await fixture();
        f.runtime.block = true;
        await f.service.handle({ tool: "run_inference", request: f.wire() });
        const response = providerResultSchema.parse(
            await f.service.handle({
                tool: "cancel_request",
                request: f.wire("cancel_request"),
            }),
        );
        expect((response.body as { status: string }).status).toBe("cancelled");
        const event = signedTerminalEventSchema.parse(
            (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                ?.terminalEvent,
        );
        expect(event.payload.outcome).toBe("cancelled");
        expect(f.accounting.events).toHaveLength(0);
        await f.service.flushTerminals();
        expect(f.accounting.events).toHaveLength(1);
    });
});

describe("authenticated admission declines", () => {
    it("persists a signed failed decision for unavailable capacity and oversized bound context", async () => {
        const f = await fixture();
        f.daemon.pause();
        await expect(
            f.service.handle({ tool: "run_inference", request: f.wire() }),
        ).rejects.toThrow("PROVIDER_UNAVAILABLE");
        const declined = await f.daemon.get(
            f.grant.requestId,
            f.grant.buyerKeyId,
        );
        expect(declined?.status).toBe("failed");
        expect(
            signedTerminalEventSchema.parse(declined?.terminalEvent).payload
                .outcome,
        ).toBe("failed");
        expect(f.accounting.authorized).toBe(0);
        await f.service.flushTerminals();
        expect(f.accounting.events).toHaveLength(1);
        f.daemon.resume();
        const payload = { prompt: "x".repeat(3000), maxOutputTokens: 8 };
        const grant = {
            ...f.grant,
            requestId: randomUUID(),
            quoteId: randomUUID(),
            grantId: randomUUID(),
            reservationId: randomUUID(),
            payloadDigest: digest(payload),
        };
        await expect(
            f.service.handle({
                tool: "run_inference",
                request: f.wire("run_inference", grant, payload),
            }),
        ).rejects.toThrow("GRANT_LIMIT_EXCEEDED");
        expect(
            (await f.daemon.get(grant.requestId, grant.buyerKeyId))?.status,
        ).toBe("failed");
    });
    it("declines a full queue without overwriting another accepted request", async () => {
        const f = await fixture();
        f.runtime.block = true;
        const grants: Grant[] = [];
        for (let i = 0; i < 4; i++)
            grants.push({
                ...f.grant,
                requestId: randomUUID(),
                quoteId: randomUUID(),
                grantId: randomUUID(),
                reservationId: randomUUID(),
            });
        try {
            for (const grant of grants.slice(0, 3))
                await f.service.handle({
                    tool: "run_inference",
                    request: f.wire("run_inference", grant),
                });
            const fourth = grants[3]!;
            await expect(
                f.service.handle({
                    tool: "run_inference",
                    request: f.wire("run_inference", fourth),
                }),
            ).rejects.toThrow("QUEUE_FULL");
            expect(
                (await f.daemon.get(fourth.requestId, fourth.buyerKeyId))
                    ?.status,
            ).toBe("failed");
            expect(
                (await f.daemon.get(grants[0]!.requestId, fourth.buyerKeyId))
                    ?.status,
            ).toBe("running");
            await f.service.flushTerminals();
            expect(f.accounting.events).toHaveLength(1);
            expect(f.accounting.events[0]?.payload.requestId).toBe(
                fourth.requestId,
            );
        } finally {
            await f.daemon.emergencyStop();
        }
    });
    it("declines the seventh accepted buyer request through the durable outbox", async () => {
        const f = await fixture();
        for (let i = 0; i < 6; i++) {
            const grant = {
                ...f.grant,
                requestId: randomUUID(),
                quoteId: randomUUID(),
                grantId: randomUUID(),
                reservationId: randomUUID(),
            };
            await f.service.handle({
                tool: "run_inference",
                request: f.wire("run_inference", grant),
            });
            await waitUntil(
                async () =>
                    (await f.daemon.get(grant.requestId, grant.buyerKeyId))
                        ?.status === "completed",
            );
        }
        await expect(
            f.service.handle({ tool: "run_inference", request: f.wire() }),
        ).rejects.toThrow("RATE_LIMITED");
        const declined = await f.daemon.get(
            f.grant.requestId,
            f.grant.buyerKeyId,
        );
        expect(declined?.status).toBe("failed");
        expect(
            signedTerminalEventSchema.parse(declined?.terminalEvent).payload
                .outcome,
        ).toBe("failed");
    });
});
describe("disposable stdio adapter", () => {
    it("survives adapter death without losing paid request state and exposes no resource/prompt bypass", async () => {
        const f = await fixture(),
            token = "local-private-token";
        await writeFile(join(f.path, "ipc-token"), token, { mode: 0o600 });
        const socket = await serveLocal(
            f.daemon,
            join(f.path, "daemon.sock"),
            token,
            (operation) => f.service.handle(operation),
        );
        const clients: Client[] = [];
        const logs: string[] = [];
        const connect = async () => {
            const transport = new StdioClientTransport({
                command: process.execPath,
                args: [
                    "--import",
                    "tsx",
                    fileURLToPath(new URL("./main.ts", import.meta.url)),
                ],
                env: {
                    ...Object.fromEntries(
                        Object.entries(process.env).filter(
                            (e): e is [string, string] => e[1] !== undefined,
                        ),
                    ),
                    PANAS_DATA_PATH: f.path,
                },
                stderr: "pipe",
            });
            transport.stderr?.on("data", (d) => logs.push(d.toString()));
            const client = new Client({ name: "host-auth-test", version: "1" });
            clients.push(client);
            await client.connect(transport);
            return client;
        };
        try {
            const first = await connect();
            expect(
                (await first.listTools()).tools.map((t) => t.name).sort(),
            ).toEqual([
                "cancel_request",
                "get_capabilities",
                "get_request",
                "run_inference",
            ]);
            const unauthenticated = await first.callTool({
                name: "run_inference",
                arguments: { ticket: "wire://" + "a".repeat(64) },
            });
            expect(unauthenticated.isError).toBe(true);
            const changed = f.wire();
            changed.payload = {
                ...f.payload,
                prompt: "changed-private-prompt",
            };
            expect(
                (
                    await first.callTool({
                        name: "run_inference",
                        arguments: changed,
                    })
                ).isError,
            ).toBe(true);
            const wire = f.wire();
            const accepted = await first.callTool({
                name: "run_inference",
                arguments: wire,
            });
            expect(accepted.isError).not.toBe(true);
            await first.close();
            await waitUntil(
                async () =>
                    (await f.daemon.get(f.grant.requestId, f.grant.buyerKeyId))
                        ?.status === "completed",
            );
            const second = await connect();
            const retrieved = await second.callTool({
                name: "get_request",
                arguments: f.wire("get_request"),
            });
            const result = providerResultSchema.parse(
                retrieved.structuredContent,
            );
            expect(
                verifyDocument(
                    DOMAIN.response,
                    result.proof,
                    f.provider.publicKey,
                ),
            ).toBe(true);
            expect((result.body as { status: string }).status).toBe(
                "completed",
            );
            await expect(
                second.readResource({ uri: "file:///etc/passwd" }),
            ).rejects.toThrow();
            await expect(second.listPrompts()).rejects.toThrow();
            expect(logs.join("")).not.toContain("changed-private-prompt");
            expect(logs.join("")).not.toContain(token);
        } finally {
            await Promise.all(clients.map((client) => client.close()));
            await new Promise<void>((resolve) => socket.close(() => resolve()));
        }
    });
});
