import { createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { superviseJoin } from "@panas/mcpwire";
import {
    DOMAIN,
    digest,
    signDocument,
    signedGrantSchema,
    quoteSchema,
    verifyDocument,
    providerResultSchema,
    type WireRequest,
    type HostOperation,
} from "@panas/protocol";
import {
    createCloudClient,
    createDiscoveryClient,
} from "../../../apps/buyer-mcp/src/clients.js";
import { descriptorSchema } from "../../../apps/buyer-mcp/src/state.js";
import { readOwnerConfig } from "../../../apps/buyer-mcp/src/config.js";
import { localConfigSchema, readPrivate, privateDirectory } from "./config.js";
import {
    evidenceSchema,
    pendingPhysicalCase,
    type CaseEvidence,
} from "./evidence.js";
import {
    launchProvider,
    stopProvider,
    portClosed,
    repositoryRoot,
    type OwnedProvider,
} from "./processes.js";
import { inspectFixtureRequest } from "./prepare.js";
import { inspectRelease } from "./release.js";
import { BuyerError } from "../../../apps/buyer-mcp/src/errors.js";
import {
    ownedRuntimePid,
    stopCapturedRuntime,
    suspendRuntime,
} from "./owned-runtime.js";

const purchaseSchema = z.object({
    signedGrant: signedGrantSchema,
    descriptor: descriptorSchema,
});
type Purchase = z.infer<typeof purchaseSchema>;
type Session = ReturnType<typeof superviseJoin>;
class SeamFailure extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}
async function poll<T>(
    action: () => Promise<T | undefined>,
    timeoutMs = 180000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    do {
        try {
            const value = await action();
            if (value !== undefined) return value;
        } catch (error) {
            if (
                !(error instanceof BuyerError) ||
                !["UNAVAILABLE", "PROVIDER_UNAVAILABLE"].includes(error.code)
            )
                throw error;
        }
        await delay(250);
    } while (Date.now() < deadline);
    throw new SeamFailure("OBSERVATION_TIMEOUT");
}
function rejection(value: unknown): string | undefined {
    const parsed = z
        .object({
            isError: z.literal(true),
            content: z
                .array(
                    z.object({
                        type: z.literal("text"),
                        text: z.string().max(1024),
                    }),
                )
                .min(1),
        })
        .safeParse(value);
    if (!parsed.success) return;
    try {
        return z
            .object({ code: z.string().regex(/^[A-Z_]+$/) })
            .parse(JSON.parse(parsed.data.content[0]!.text)).code;
    } catch {
        return "INVALID_REJECTION";
    }
}
export async function runFaultSeams(path: string): Promise<string> {
    const config = localConfigSchema.parse(JSON.parse(await readPrivate(path)));
    const owner = readOwnerConfig(config.buyerConfigPath);
    const privateKey = createPrivateKey(
        await readPrivate(owner.privateKeyPath),
    );
    const cloud = createCloudClient({
        url: config.accountingUrl,
        buyerId: owner.buyerId,
        privateKey,
    });
    const discovery = createDiscoveryClient({
        url: config.registryUrl,
        token: (await readPrivate(owner.discoveryTokenPath)).trim(),
    });
    const baseline = await inspectFixtureRequest(path, randomUUID());
    if (baseline.held !== "0") throw new SeamFailure("FIXTURE_HAS_PRIOR_HOLDS");
    await privateDirectory(config.privateDir);
    const owned: OwnedProvider[] = [],
        sessions: Session[] = [],
        cases: CaseEvidence[] = [];
    const runId = randomUUID(),
        startedAt = new Date().toISOString();
    const sourceTreeDirty =
        execFileSync("git", ["status", "--porcelain"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim().length > 0;
    let resume: (() => void) | undefined,
        failed = false,
        stopped = true;
    const purchased: Purchase[] = [];
    const payload = { prompt: "Reply with hello pana.", maxOutputTokens: 16 };
    const mark = (
        id: string,
        detail: string,
        requests: Purchase[] = [],
        source: CaseEvidence["source"] = "real_cloud_one_mac",
    ) =>
        cases.push({
            id,
            status: "passed",
            source,
            detail,
            ...(requests.length
                ? {
                      requestIds: requests.map(
                          (p) => p.signedGrant.payload.requestId,
                      ),
                  }
                : {}),
        });
    const buy = async (providerId: string): Promise<Purchase> => {
        const quote = quoteSchema.parse(
            await cloud.quote({
                providerId,
                sessionId: owner.sessionId,
                requestId: randomUUID(),
                payloadDigest: digest(payload),
                maxOutputTokens: payload.maxOutputTokens,
            }),
        );
        const purchase = purchaseSchema.parse(
            await cloud.purchase({
                quoteId: quote.quoteId,
                idempotencyKey: randomUUID(),
            }),
        );
        purchased.push(purchase);
        return purchase;
    };
    const envelope = (
        p: Purchase,
        operation: HostOperation = "run_inference",
        key = privateKey,
    ): WireRequest => {
        const body = operation === "run_inference" ? payload : {};
        return {
            grant: p.signedGrant,
            payload: body,
            proof: signDocument(
                DOMAIN.operation,
                {
                    version: 1,
                    grantId: p.signedGrant.payload.grantId,
                    requestId: p.signedGrant.payload.requestId,
                    operation,
                    nonce: randomUUID(),
                    payloadDigest: digest(body),
                    issuedAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                },
                key,
            ),
        };
    };
    const connect = async (p: Purchase) => {
        // Initialization can reconnect; no tool invocation or paid operation has been dispatched.
        const outcomes: string[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
            const session = superviseJoin({
                ticket: p.descriptor.ticket,
                startupTimeoutMs: 35000,
            });
            sessions.push(session);
            const outcome = await session.ready;
            if (outcome.kind === "ready") return session;
            outcomes.push(outcome.code);
            await session.stop();
            await delay(500);
        }
        await writeFile(
            join(config.privateDir, "peer-startup.private.json"),
            JSON.stringify({ outcomes }),
            { mode: 0o600 },
        );
        throw new SeamFailure("PEER_INITIALIZATION_FAILED_WITHOUT_DISPATCH");
    };
    const call = (s: Session, tool: HostOperation, request: unknown) =>
        s.request(
            "tools/call",
            { name: tool, arguments: request },
            { timeoutMs: 15000 },
        );
    const expectRejected = async (
        s: Session,
        tool: HostOperation,
        request: unknown,
        code: string,
    ) => {
        const actual = rejection(await call(s, tool, request));
        if (actual !== code)
            throw new SeamFailure(
                `HOST_${actual ?? "NO_REJECTION"}_EXPECTED_${code}`,
            );
    };
    const verified = async (
        s: Session,
        tool: HostOperation,
        wire: WireRequest,
    ) => {
        const result = z
            .object({ structuredContent: providerResultSchema })
            .parse(await call(s, tool, wire)).structuredContent;
        const proof = result.proof.payload;
        if (
            !verifyDocument(
                DOMAIN.response,
                result.proof,
                wire.grant.payload.providerPublicKeyPem,
            ) ||
            proof.requestId !== wire.grant.payload.requestId ||
            proof.nonce !== wire.proof.payload.nonce ||
            proof.operation !== tool ||
            proof.startupId !== wire.grant.payload.startupId ||
            proof.providerId !== wire.grant.payload.providerId ||
            proof.resultDigest !== digest(result.body)
        )
            throw new SeamFailure("PROVIDER_RESPONSE_BINDING_FAILED");
        return z
            .object({ requestId: z.uuid(), status: z.string() })
            .parse(result.body);
    };
    const terminal = (p: Purchase, expected: string, amount: string) =>
        poll(async () => {
            const value = z
                .object({
                    status: z.string(),
                    receipt: z
                        .object({
                            receiptId: z.uuid(),
                            buyerDebitAtomic: z.string(),
                            providerEarningsAtomic: z.string(),
                            feeAtomic: z.string(),
                        })
                        .nullable(),
                })
                .parse(await cloud.get(p.signedGrant.payload.requestId));
            if (!value.receipt) return;
            if (
                value.status !== expected ||
                value.receipt.buyerDebitAtomic !== amount ||
                BigInt(value.receipt.providerEarningsAtomic) +
                    BigInt(value.receipt.feeAtomic) !==
                    BigInt(amount)
            )
                throw new SeamFailure("TERMINAL_RECEIPT_MISMATCH");
            const persisted = await inspectFixtureRequest(
                path,
                p.signedGrant.payload.requestId,
            );
            if (persisted.settlements !== (amount === "0" ? 0 : 1))
                throw new SeamFailure("SETTLEMENT_COUNT_MISMATCH");
            return value.receipt;
        });
    const noExecution = async (p: Purchase, s: Session) => {
        const row = await inspectFixtureRequest(
            path,
            p.signedGrant.payload.requestId,
        );
        if (
            row.status !== "reserved" ||
            row.hasReceipt ||
            row.settlements !== 0
        )
            throw new SeamFailure("REJECTED_PROOF_CREATED_TERMINAL");
        await expectRejected(
            s,
            "get_request",
            envelope(p, "get_request"),
            "REQUEST_NOT_FOUND",
        );
    };
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () =>
        (cleanupPromise ??= (async () => {
            resume?.();
            await Promise.all(
                sessions.map((s) =>
                    s.stop().catch(() => {
                        stopped = false;
                    }),
                ),
            );
            const captured = owned.map((p) => {
                try {
                    return { provider: p, pid: ownedRuntimePid(p) };
                } catch {
                    return undefined;
                }
            });
            await Promise.all(
                owned.map((p) =>
                    stopProvider(p).catch(() => {
                        stopped = false;
                    }),
                ),
            );
            for (const item of captured)
                if (item) stopCapturedRuntime(item.provider, item.pid);
            await delay(300);
        })());
    const signalCleanup = () => {
        void cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", signalCleanup);
    process.once("SIGTERM", signalCleanup);
    try {
        for (const env of config.providerEnvs)
            owned.push(await launchProvider(env));
        await poll(async () => {
            if (
                owned.some(
                    (p) =>
                        p.child.exitCode !== null ||
                        p.child.signalCode !== null,
                )
            )
                throw new SeamFailure("HOST_EXITED_BEFORE_READINESS");
            const value = z
                .object({
                    providers: z.array(
                        z.object({
                            providerId: z.uuid(),
                            readiness: z.object({ ready: z.boolean() }),
                        }),
                    ),
                })
                .parse(
                    await discovery.discover({ readyOnly: true, limit: 50 }),
                );
            return config.providerIds.every((id) =>
                value.providers.some(
                    (p) => p.providerId === id && p.readiness.ready,
                ),
            )
                ? true
                : undefined;
        });
        const expires = await buy(config.providerIds[1]),
            expiryPeer = await connect(expires);
        const legitimate = await buy(config.providerIds[0]),
            peer = await connect(legitimate);
        await expectRejected(
            peer,
            "run_inference",
            { grant: {}, proof: {}, payload },
            "OPERATION_REJECTED",
        );
        await noExecution(legitimate, peer);
        mark(
            "copied-ticket-without-entitlement",
            "A raw MCP peer holding the real copied connectivity ticket invoked inference without entitlement; host rejected it and cloud reservation/local request remained unchanged.",
            [legitimate],
        );
        const alteredGrant = envelope(legitimate);
        alteredGrant.grant = {
            ...alteredGrant.grant,
            payload: {
                ...alteredGrant.grant.payload,
                totalAtomic: "99",
                providerAtomic: "99",
            },
        };
        await expectRejected(
            peer,
            "run_inference",
            alteredGrant,
            "INVALID_PLATFORM_GRANT",
        );
        const alteredPayload = envelope(legitimate);
        alteredPayload.payload = { ...payload, prompt: "altered" };
        await expectRejected(
            peer,
            "run_inference",
            alteredPayload,
            "OPERATION_BINDING_MISMATCH",
        );
        await expectRejected(
            peer,
            "run_inference",
            envelope(
                legitimate,
                "run_inference",
                generateKeyPairSync("ed25519").privateKey,
            ),
            "IDENTITY_MISMATCH",
        );
        const stale = envelope(legitimate);
        stale.proof = signDocument(
            DOMAIN.operation,
            {
                ...stale.proof.payload,
                expiresAt: new Date(Date.now() + 500).toISOString(),
            },
            privateKey,
        );
        await delay(800);
        await expectRejected(
            peer,
            "run_inference",
            stale,
            "OPERATION_REJECTED",
        );
        await noExecution(legitimate, peer);
        mark(
            "altered-grant-payload-buyer-and-expired-proof",
            "Actual cloud purchase rejected altered signed grant, payload tampering, another buyer key and a proof allowed to expire in real time. None minted execution, settlement or fabricated provider terminal state; original request then remained usable.",
            [legitimate],
        );
        const original = envelope(legitimate);
        await verified(peer, "run_inference", original);
        await expectRejected(
            peer,
            "run_inference",
            original,
            "REPLAYED_OPERATION",
        );
        const completed = await terminal(legitimate, "completed", "1");
        const lateCancel = await verified(
            peer,
            "cancel_request",
            envelope(legitimate, "cancel_request"),
        );
        if (
            lateCancel.status !== "completed" ||
            (await terminal(legitimate, "completed", "1")).receiptId !==
                completed.receiptId
        )
            throw new SeamFailure("LATE_CANCEL_CHANGED_RECEIPT");
        mark(
            "exact-operation-replay",
            "Replayed identical signed operation/nonce through the actual peer was rejected; legitimate run settled once and late cancellation preserved the exact completed receipt.",
            [legitimate],
        );
        const queue: Purchase[] = [];
        for (let n = 0; n < 4; n++)
            queue.push(await buy(config.providerIds[0]));
        resume = suspendRuntime(owned[0]!);
        try {
            for (const p of queue.slice(0, 3)) {
                const accepted = await verified(
                    peer,
                    "run_inference",
                    envelope(p),
                );
                if (accepted.status !== "running")
                    throw new SeamFailure("ADMISSION_NOT_RUNNING");
            }
            await expectRejected(
                peer,
                "run_inference",
                envelope(queue[3]!),
                "QUEUE_FULL",
            );
            for (const p of [queue[1]!, queue[2]!, queue[0]!]) {
                if (
                    (
                        await verified(
                            peer,
                            "cancel_request",
                            envelope(p, "cancel_request"),
                        )
                    ).status !== "cancelled"
                )
                    throw new SeamFailure("CONTROLLED_CANCEL_DID_NOT_WIN");
            }
        } finally {
            resume();
            resume = undefined;
        }
        for (const p of queue.slice(0, 3)) await terminal(p, "cancelled", "0");
        await terminal(queue[3]!, "failed", "0");
        mark(
            "queue-overflow-e2e",
            "Verified owned native Ollama listener was briefly SIGSTOPed (3s automatic SIGCONT guard). One active plus two queued real paid requests filled the persistent daemon; fourth received QUEUE_FULL and durable failed zero-charge receipt. No shared process or physical sleep was used.",
            queue,
            "fault_injected_cloud_one_mac",
        );
        mark(
            "controlled-cancel-orderings",
            "Queued/active cancellation before model progress produced durable cancelled zero-charge receipts; the separately completed request rejected late state reversal and kept its exact one-charge receipt. This establishes controlled orderings, not a simultaneous cancel/completion race.",
            [legitimate, ...queue.slice(0, 3)],
            "fault_injected_cloud_one_mac",
        );
        const wait =
            Date.parse(expires.signedGrant.payload.executeBefore) -
            Date.now() +
            100;
        if (wait > 121000)
            throw new SeamFailure("EXECUTION_EXPIRY_OUT_OF_BOUND");
        if (wait > 0) await delay(wait);
        await expectRejected(
            expiryPeer,
            "run_inference",
            envelope(expires),
            "EXECUTION_BINDING_MISMATCH",
        );
        await noExecution(expires, expiryPeer);
        mark(
            "expired-execution-grant-e2e",
            "Real cloud-issued executeBefore elapsed with no clock mocking; a fresh buyer proof could not execute it. No local record/terminal or debit was fabricated. Its original reservation is intentionally held for bounded reconciliation and audited operator review; no silent refund.",
            [expires],
        );
    } catch (error) {
        await writeFile(
            join(config.privateDir, `failure-${runId}.private.log`),
            error instanceof Error
                ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
                : "Unknown failure",
            { mode: 0o600 },
        );
        failed = true;
        cases.push({
            id: "fault-run-failure",
            requestIds: purchased.map((p) => p.signedGrant.payload.requestId),
            status: "failed",
            source: "fault_injected_cloud_one_mac",
            detail:
                error instanceof SeamFailure ? error.code : "FAULT_SEAM_FAILED",
        });
    } finally {
        process.off("SIGINT", signalCleanup);
        process.off("SIGTERM", signalCleanup);
        await cleanup();
    }
    const ports = (
        await Promise.all(config.runtimePorts.map(portClosed))
    ).every(Boolean);
    const release = await inspectRelease(config.releaseEvidencePath);
    cases.push(pendingPhysicalCase);
    for (const id of [
        "cancel-completion-simultaneous-race-e2e",
        "deadline-e2e",
        "provider-crash-e2e",
        "sleep-wake-e2e",
        "volcano-outage-e2e",
    ])
        cases.push({
            id,
            status: "not_run",
            source: "real_cloud_one_mac",
            detail: "Not established by controlled cancellation/owned process suspension; requires its own actual observation.",
        });
    const report = evidenceSchema.parse({
        version: 1,
        runId,
        mode: "fault-seams",
        startedAt,
        finishedAt: new Date().toISOString(),
        gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim(),
        sourceTreeDirty,
        ...(release.reference ? { releaseReference: release.reference } : {}),
        physicalMachineCount: 1,
        logicalProviderCount: 2,
        caseEvidence: cases,
        gates: {
            twoPhysicalMacs: "pending",
            release9: release.status,
            issue10Complete: false,
        },
        cleanup: { ownedProcessesStopped: stopped, runtimePortsClosed: ports },
    });
    const output = join(config.privateDir, `fault-evidence-${runId}.json`);
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
    });
    if (failed || !stopped || !ports)
        throw new SeamFailure("FAULT_RUN_FAILED_EVIDENCE_SAVED");
    return output;
}
