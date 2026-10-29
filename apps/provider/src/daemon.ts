import { createHash, randomUUID } from "node:crypto";
import {
    prototypeLimits,
    inferenceRequestSchema,
    type InferenceRequest,
} from "@panas/contracts";
import {
    passedLocalCapabilities,
    type CapabilityReport,
} from "@panas/contracts/provider";
import {
    testCapabilities,
    type CapabilityConfig,
    type HostInfo,
} from "./capabilities.js";
import type { RequestHooks } from "./hooks.js";
import type { InferenceRuntime } from "./runtime.js";
import { EncryptedStore, type StoredRequest } from "./store.js";

export class ProviderError extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}
interface Task {
    request: InferenceRequest;
    buyerKeyId: string;
    record: StoredRequest;
    abort: AbortController;
    cancelled: boolean;
}
export class ProviderDaemon {
    report: CapabilityReport | undefined;
    private active: Task | undefined;
    private queue: Task[] = [];
    private paused = false;
    private draining = false;
    private tail: Promise<unknown> = Promise.resolve();
    private testing: Promise<CapabilityReport> | undefined;
    private lastHeartbeatAt = 0;
    private lastProgressAt: number;
    private livenessEpoch = 0;
    private recoveryRequired = false;
    private wakeStop: Promise<void> | undefined;
    private buyerAdmissions = new Map<string, number[]>();
    private uncertainRequests = new Set<string>();
    constructor(
        readonly config: CapabilityConfig,
        readonly runtime: InferenceRuntime,
        readonly store: EncryptedStore,
        readonly host: () => Promise<HostInfo>,
        readonly now = () => Date.now(),
        readonly hooks: RequestHooks = {},
    ) {
        this.lastProgressAt = now();
    }
    /** Called by the host pulse even while a controller operation is awaiting I/O. */
    observeLiveness(): boolean {
        const now = this.now();
        const gap = now - this.lastProgressAt;
        this.lastProgressAt = now;
        if (
            gap < 0 ||
            gap >= 45000 ||
            (this.report?.peerProbe.status === "verified" &&
                now - this.lastHeartbeatAt >= 45000)
        ) {
            this.livenessEpoch++;
            this.recoveryRequired = true;
            this.invalidate(new ProviderError("PROVIDER_SUSPENDED"));
            // Start stopping the owned runtime immediately, including during capability tests.
            const stopping = this.wakeStop ?? this.runtime.stop();
            this.wakeStop = stopping;
            void stopping.then(
                () => {
                    if (this.wakeStop === stopping) this.wakeStop = undefined;
                },
                () => {
                    if (this.wakeStop === stopping) this.wakeStop = undefined;
                },
            );
        }
        return this.recoveryRequired;
    }
    private exclusive<T>(action: () => Promise<T>): Promise<T> {
        const result = this.tail.then(action);
        this.tail = result.catch(() => {});
        return result;
    }
    async launch(): Promise<CapabilityReport> {
        await this.store.init();
        await this.store.recoverAndCleanup();
        return this.retest();
    }
    async retest(): Promise<CapabilityReport> {
        if (this.testing) return this.testing;
        if (this.active || this.queue.length)
            throw new ProviderError("BUSY_CANNOT_RETEST");
        this.observeLiveness();
        this.report = undefined;
        this.testing = (async () => {
            await this.wakeStop;
            const epoch = this.livenessEpoch;
            const report = await testCapabilities(
                this.config,
                this.runtime,
                await this.host(),
                randomUUID(),
                this.now,
            );
            this.observeLiveness();
            if (epoch !== this.livenessEpoch) report.state = "unhealthy";
            else this.recoveryRequired = false;
            this.report = report;
            this.lastHeartbeatAt = this.now();
            return report;
        })();
        try {
            return await this.testing;
        } finally {
            this.testing = undefined;
        }
    }
    get status(): CapabilityReport | undefined {
        this.observeLiveness();
        if (!this.report) return;
        const state =
            this.report.state === "unhealthy"
                ? "unhealthy"
                : this.paused
                  ? "paused"
                  : this.draining
                    ? "draining"
                    : this.active
                      ? "busy"
                      : this.report.state;
        return { ...this.report, state };
    }
    verifyPeer(evidence: {
        startupId: string;
        status: "verified" | "failed" | "unverified";
        testedAt: string;
    }): void {
        if (this.observeLiveness()) throw new ProviderError("STALE_PEER_PROBE");
        const report = this.report;
        if (
            !report ||
            report.startupId !== evidence.startupId ||
            !Number.isFinite(Date.parse(evidence.testedAt)) ||
            Date.parse(evidence.testedAt) < Date.parse(report.testedAt) ||
            Date.parse(evidence.testedAt) > this.now() + 5000
        )
            throw new ProviderError("STALE_PEER_PROBE");
        report.peerProbe = {
            status: evidence.status,
            testedAt: evidence.testedAt,
        };
        report.state =
            passedLocalCapabilities(report) && evidence.status === "verified"
                ? "ready"
                : evidence.status === "failed"
                  ? "unhealthy"
                  : "testing";
        if (report.state === "ready") this.lastHeartbeatAt = this.now();
    }
    heartbeat(): CapabilityReport | null {
        const report = this.status;
        if (
            !report ||
            !passedLocalCapabilities(report) ||
            report.peerProbe.status !== "verified" ||
            report.state === "unhealthy" ||
            report.state === "testing" ||
            this.now() - Date.parse(report.testedAt) > 86400000
        )
            return null;
        if (this.lastHeartbeatAt && this.now() - this.lastHeartbeatAt > 45000) {
            this.invalidate();
            return null;
        }
        this.lastHeartbeatAt = this.now();
        this.report!.sequence++;
        return { ...report, sequence: this.report!.sequence };
    }
    async health(): Promise<void> {
        this.observeLiveness();
        if (!this.report || this.testing) return;
        if (this.recoveryRequired) {
            await this.wakeStop;
            if (this.active) return;
            // Accepted work is never replayed after a liveness interruption, even while paused.
            await this.exclusive(() => this.failQueued());
            await this.retest();
            return;
        }
        if (this.report.state === "unhealthy" && !this.active) {
            await this.exclusive(() => this.failQueued());
            await this.retest();
            return;
        }
        if (this.lastHeartbeatAt && this.now() - this.lastHeartbeatAt > 45000) {
            this.invalidate();
            if (!this.active && !this.queue.length) await this.retest();
            return;
        }
        try {
            const info = await this.runtime.info();
            if (this.observeLiveness()) return;
            if (
                info.digest !== this.config.expectedDigest ||
                info.version !== this.config.expectedRuntimeVersion
            ) {
                this.invalidate();
                if (!this.active && !this.queue.length) await this.retest();
            }
        } catch {
            this.invalidate();
        }
        await this.store.recoverAndCleanup(false);
    }
    private invalidate(reason?: Error): void {
        if (this.report) {
            this.report.state = "unhealthy";
            this.report.peerProbe = { status: "unverified" };
        }
        this.active?.abort.abort(reason);
    }
    pause(): void {
        this.paused = true;
    }
    resume(): void {
        this.paused = false;
        this.draining = false;
        this.kick();
    }
    drain(): void {
        this.draining = true;
    }
    async emergencyStop(): Promise<void> {
        this.paused = true;
        this.invalidate();
        try {
            for (const task of [...this.queue])
                await this.cancel(task.request.requestId, task.buyerKeyId);
            if (this.active)
                await this.cancel(
                    this.active.request.requestId,
                    this.active.buyerKeyId,
                );
        } finally {
            await this.runtime.stop();
        }
    }
    async get(
        requestId: string,
        buyerKeyId: string,
    ): Promise<StoredRequest | undefined> {
        const r = await this.store.get(requestId);
        if (r && r.buyerKeyId !== buyerKeyId)
            throw new ProviderError("FORBIDDEN");
        if (r && this.uncertainRequests.has(requestId)) {
            const { result: _result, terminalEvent: _event, ...pending } = r;
            void _result;
            void _event;
            return {
                ...pending,
                status: "unknown",
                error: "PERSISTENCE_UNCERTAIN",
            };
        }
        return r;
    }
    // Called only by trusted local IPC/host adapter. Paid entitlement verification belongs to host issue #6.
    async submit(
        input: unknown,
        buyerKeyId: string,
        authorization?: unknown,
    ): Promise<StoredRequest> {
        const request = inferenceRequestSchema.parse(input);
        if (!buyerKeyId || buyerKeyId.length > 512)
            throw new ProviderError("INVALID_BUYER");
        // qwen2 byte-BPE raw mode: UTF8 bytes conservatively upper-bound prompt tokens.
        // Reserve output + special-token headroom so the runtime never silently truncates a valid admitted input.
        if (
            Buffer.byteLength(request.prompt, "utf8") >
            prototypeLimits.maxContextTokens - request.maxOutputTokens - 16
        )
            throw new ProviderError("CONTEXT_TOO_LARGE");
        const fingerprint = createHash("sha256")
            .update(JSON.stringify({ request, buyerKeyId }))
            .digest("hex");
        return this.exclusive(async () => {
            const existing = await this.get(request.requestId, buyerKeyId);
            if (existing) {
                if (existing.fingerprint !== fingerprint)
                    throw new ProviderError("IDEMPOTENCY_CONFLICT");
                return existing;
            }
            const report = this.status;
            if (
                report &&
                (this.now() - Date.parse(report.testedAt) > 86400000 ||
                    this.now() - this.lastHeartbeatAt > 45000)
            ) {
                this.invalidate();
                throw new ProviderError("PROVIDER_UNAVAILABLE");
            }
            if (
                !report ||
                !passedLocalCapabilities(report) ||
                report.peerProbe.status !== "verified" ||
                !["ready", "busy"].includes(report.state)
            )
                throw new ProviderError("PROVIDER_UNAVAILABLE");
            if (this.queue.length >= prototypeLimits.queueDepth && this.active)
                throw new ProviderError("QUEUE_FULL");
            const recent = (this.buyerAdmissions.get(buyerKeyId) ?? []).filter(
                (at) => this.now() - at < 60000,
            );
            if (recent.length >= 6) throw new ProviderError("RATE_LIMITED");
            const record: StoredRequest = {
                requestId: request.requestId,
                buyerKeyId,
                fingerprint,
                status: "running",
                updatedAt: this.now(),
                ...(authorization === undefined ? {} : { authorization }),
            };
            await this.store.save(record);
            const task: Task = {
                request,
                buyerKeyId,
                record,
                abort: new AbortController(),
                cancelled: false,
            };
            this.queue.push(task);
            this.buyerAdmissions.set(buyerKeyId, [...recent, this.now()]);
            this.kick();
            return record;
        });
    }
    async declineAuthenticated(
        input: unknown,
        buyerKeyId: string,
        authorization: unknown,
        code: string,
    ): Promise<StoredRequest> {
        const request = inferenceRequestSchema.parse(input);
        return this.exclusive(async () => {
            const existing = await this.get(request.requestId, buyerKeyId);
            if (existing) return existing;
            const record: StoredRequest = {
                requestId: request.requestId,
                buyerKeyId,
                fingerprint: createHash("sha256")
                    .update(JSON.stringify({ request, buyerKeyId }))
                    .digest("hex"),
                status: "failed",
                updatedAt: this.now(),
                error: code,
                authorization,
            };
            await this.persistTerminal(record);
            return record;
        });
    }
    private kick(): void {
        void this.pump().catch(() => {
            this.invalidate();
            void this.runtime.stop().catch(() => {});
        });
    }
    private async pump(): Promise<void> {
        if (
            this.active ||
            this.paused ||
            !this.queue.length ||
            this.recoveryRequired ||
            this.report?.state !== "ready"
        )
            return;
        const task = this.queue.shift()!;
        this.active = task;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const executionTimeout =
                this.hooks.timeoutMs?.(task.record) ??
                prototypeLimits.timeoutMs;
            if (
                !Number.isInteger(executionTimeout) ||
                executionTimeout < 1 ||
                executionTimeout > prototypeLimits.timeoutMs
            )
                throw new ProviderError("INVALID_EXECUTION_LIMIT");
            const startedAt = this.now();
            const deadline = startedAt + executionTimeout;
            const assertLive = () => {
                this.observeLiveness();
                if (this.recoveryRequired)
                    task.abort.abort(new ProviderError("PROVIDER_SUSPENDED"));
                if (this.now() >= deadline)
                    task.abort.abort(new ProviderError("DEADLINE_EXCEEDED"));
                if (task.abort.signal.aborted) throw task.abort.signal.reason;
            };
            assertLive();
            timeout = setTimeout(
                () => task.abort.abort(new Error("DEADLINE_EXCEEDED")),
                executionTimeout,
            );
            const info = await this.runtime.info(task.abort.signal);
            assertLive();
            if (
                info.digest !== this.config.expectedDigest ||
                info.version !== this.config.expectedRuntimeVersion
            )
                throw new ProviderError("RUNTIME_CHANGED");
            await this.hooks.beforeExecute?.(
                task.record,
                task.request,
                task.abort.signal,
            );
            assertLive();
            const result = await this.runtime.generate(
                task.request.prompt,
                task.request.maxOutputTokens,
                task.abort.signal,
            );
            await this.exclusive(async () => {
                if (task.cancelled) return;
                // A native response can resume before the timer callback on wake.
                assertLive();
                task.record = {
                    ...task.record,
                    status: "completed",
                    result,
                    updatedAt: this.now(),
                };
                await this.persistTerminal(task.record);
            });
        } catch {
            await this.exclusive(async () => {
                if (
                    task.cancelled ||
                    this.uncertainRequests.has(task.record.requestId)
                ) {
                    this.invalidate();
                    return;
                }
                task.record = {
                    ...task.record,
                    status: "failed",
                    updatedAt: this.now(),
                    error: task.abort.signal.aborted
                        ? task.abort.signal.reason instanceof ProviderError &&
                          task.abort.signal.reason.code === "PROVIDER_SUSPENDED"
                            ? "PROVIDER_SUSPENDED"
                            : "DEADLINE_EXCEEDED"
                        : "RUNTIME_FAILED",
                };
                this.invalidate();
                await this.persistTerminal(task.record);
            });
        } finally {
            if (timeout) clearTimeout(timeout);
            if (task.abort.signal.aborted) {
                this.invalidate();
                await (this.wakeStop ?? this.runtime.stop());
            }
            this.active = undefined;
            if (this.status?.state === "unhealthy") {
                await this.exclusive(() => this.failQueued());
            } else this.kick();
        }
    }
    private async failQueued(): Promise<void> {
        while (this.queue.length) {
            const queued = this.queue.shift()!;
            queued.record = {
                ...queued.record,
                status: "failed",
                error: "PROVIDER_UNAVAILABLE",
                updatedAt: this.now(),
            };
            await this.persistTerminal(queued.record);
        }
    }
    private async persistTerminal(record: StoredRequest): Promise<void> {
        if (
            record.authorization &&
            record.status !== "running" &&
            !record.terminalEvent
        ) {
            record.terminalEvent = this.hooks.terminalEvent?.(record);
            if (!record.terminalEvent)
                throw new ProviderError("TERMINAL_EVENT_REQUIRED");
            record.terminalDelivered = false;
        }
        try {
            await this.store.save(record);
        } catch {
            this.uncertainRequests.add(record.requestId);
            this.invalidate();
            throw new ProviderError("PERSISTENCE_UNCERTAIN");
        }
    }
    async pendingTerminals(): Promise<StoredRequest[]> {
        return this.exclusive(async () =>
            (await this.store.list()).filter(
                (record) =>
                    record.terminalEvent &&
                    !record.terminalDelivered &&
                    !this.uncertainRequests.has(record.requestId),
            ),
        );
    }
    async recoverTerminalEvents(): Promise<void> {
        for (const record of await this.store.list()) {
            if (
                record.authorization &&
                record.status !== "running" &&
                !record.terminalEvent
            )
                await this.persistTerminal(record);
        }
    }
    async acknowledgeTerminal(requestId: string): Promise<void> {
        await this.exclusive(async () => {
            const record = await this.store.get(requestId);
            if (record?.terminalEvent) {
                record.terminalDelivered = true;
                await this.store.save(record);
            }
        });
    }
    async cancel(
        requestId: string,
        buyerKeyId: string,
    ): Promise<StoredRequest | undefined> {
        return this.exclusive(async () => {
            const record = await this.get(requestId, buyerKeyId);
            if (!record || record.status !== "running") return record;
            const task =
                this.active?.request.requestId === requestId
                    ? this.active
                    : this.queue.find((t) => t.request.requestId === requestId);
            if (!task) return record;
            task.cancelled = true;
            if (task === this.active) this.invalidate();
            task.abort.abort();
            this.queue = this.queue.filter((t) => t !== task);
            task.record = {
                ...record,
                status: "cancelled",
                updatedAt: this.now(),
            };
            await this.persistTerminal(task.record);
            return task.record;
        });
    }
}
