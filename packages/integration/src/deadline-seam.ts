import { createPrivateKey, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
    DOMAIN,
    digest,
    keyId,
    signDocument,
    signedGrantSchema,
    providerResultSchema,
    verifyDocument,
} from "@panas/protocol";
import { superviseJoin } from "@panas/mcpwire";
import { createCloudClient } from "../../../apps/buyer-mcp/src/clients.js";
import { PrivateStore } from "../../../apps/buyer-mcp/src/store.js";
import {
    buyerStateSchema,
    descriptorSchema,
} from "../../../apps/buyer-mcp/src/state.js";
import { localConfigSchema, readPrivate } from "./config.js";
import { connectBuyer, ToolFailure } from "./mcp-client.js";
import {
    launchProvider,
    stopProvider,
    portClosed,
    repositoryRoot,
    type OwnedProvider,
} from "./processes.js";
import { prepareDelayedRuntime } from "./delayed-runtime.js";
import {
    evidenceSchema,
    pendingPhysicalCase,
    type CaseEvidence,
} from "./evidence.js";
import { inspectFixtureRequest } from "./prepare.js";
import { inspectRelease } from "./release.js";
import { readOwnerConfig } from "../../../apps/buyer-mcp/src/config.js";
import { callDaemon } from "../../../apps/provider-mcp/src/ipc-client.js";

async function poll<T>(
    fn: () => Promise<T | undefined>,
    ms: number,
): Promise<T> {
    const end = Date.now() + ms;
    do {
        try {
            const value = await fn();
            if (value !== undefined) return value;
        } catch (error) {
            if (
                !(error instanceof ToolFailure) ||
                !["UNAVAILABLE", "PROVIDER_UNAVAILABLE", "UNCERTAIN"].includes(
                    error.code,
                )
            )
                throw error;
        }
        await delay(500);
    } while (Date.now() < end);
    throw new Error("DEADLINE_OBSERVATION_TIMEOUT");
}
/** Actual paid work/native generation, with only its completed HTTP response withheld. */
export async function runDeadlineSeam(
    path: string,
    race = false,
): Promise<string> {
    const config = localConfigSchema.parse(JSON.parse(await readPrivate(path))),
        owner = readOwnerConfig(config.buyerConfigPath);
    const env = parseEnv(await readPrivate(config.providerEnvs[1]));
    if (!env.PANAS_OLLAMA_BINARY || !env.PANAS_DATA_PATH)
        throw new Error("DEADLINE_OWNER_CONFIGURATION_REQUIRED");
    const runId = randomUUID(),
        startedAt = new Date().toISOString(),
        gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim();
    const sourceTreeDirty =
        execFileSync("git", ["status", "--porcelain"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim().length > 0;
    const wrapper = await prepareDelayedRuntime({
        privateDir: config.privateDir,
        binary: env.PANAS_OLLAMA_BINARY,
        externalPort: 11602,
        upstreamPort: 11612,
    });
    let provider: OwnedProvider | undefined,
        buyer: Awaited<ReturnType<typeof connectBuyer>> | undefined,
        requestId: string | undefined,
        failed = false,
        stopped = true;
    const cases: CaseEvidence[] = [];
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () =>
        (cleanupPromise ??= (async () => {
            await wrapper.setHoldGenerate(false);
            await buyer?.close().catch(() => {
                stopped = false;
            });
            if (provider)
                await stopProvider(provider).catch(() => {
                    stopped = false;
                });
            await wrapper.close().catch(() => {
                stopped = false;
            });
        })());
    const signal = () => {
        void cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", signal);
    process.once("SIGTERM", signal);
    try {
        provider = await launchProvider(config.providerEnvs[1], {
            PANAS_OLLAMA_BINARY: wrapper.binaryPath,
        });
        buyer = await connectBuyer(config.buyerConfigPath);
        await poll(async () => {
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
                    await buyer!.call("discover_providers", {
                        readyOnly: true,
                        limit: 50,
                    }),
                );
            return value.providers.some(
                (p) =>
                    p.providerId === config.providerIds[1] && p.readiness.ready,
            )
                ? true
                : undefined;
        }, 180000);
        const before = await wrapper.snapshot();
        await wrapper.setHoldGenerate(true);
        const quote = await buyer.call("quote_inference", {
            providerId: config.providerIds[1],
            prompt: "Reply with hello pana.",
            maxOutputTokens: 16,
        });
        const limits = z
            .object({ timeoutMs: z.literal(60000) })
            .parse(quote.limits);
        const purchase = await buyer.call("purchase_access", {
            quoteId: quote.quoteId,
            idempotencyKey: randomUUID(),
        });
        requestId = z.uuid().parse(purchase.requestId);
        const dispatchAt = Date.now();
        await buyer.call("run_inference", { requestId });
        const held = await poll(async () => {
            const s = await wrapper.snapshot();
            return s.nativeGenerationsCompleted >
                before.nativeGenerationsCompleted && s.heldGenerations === 1
                ? s
                : undefined;
        }, 10000);
        const authorized = await inspectFixtureRequest(path, requestId);
        if (authorized.status !== "authorized" || authorized.settlements !== 0)
            throw new Error("WORK_NOT_AUTHORIZED_WITHOUT_SETTLEMENT");
        if (race) {
            // Close the sole writer before owner inspection of its actual encrypted purchase artifact.
            await buyer.close();
            buyer = undefined;
            const state = new PrivateStore(
                owner.dataDir,
                (value) => buyerStateSchema.parse(value),
                () => ({
                    version: 1 as const,
                    buyerId: owner.buyerId,
                    requests: {},
                }),
            );
            let original;
            try {
                original = state.load().requests[requestId];
            } finally {
                state.close();
            }
            if (!original?.signedGrant)
                throw new Error("ORIGINAL_PURCHASE_ARTIFACT_REQUIRED");
            const privateKey = createPrivateKey(
                await readPrivate(owner.privateKeyPath),
            );
            const cloud = createCloudClient({
                url: config.accountingUrl,
                buyerId: owner.buyerId,
                privateKey,
            });
            await cloud.cancel(requestId);
            const action = z
                .object({
                    signedGrant: signedGrantSchema,
                    descriptor: descriptorSchema,
                })
                .parse(await cloud.get(requestId));
            const grant = action.signedGrant;
            if (
                !verifyDocument(
                    DOMAIN.grant,
                    grant,
                    await readPrivate(owner.platformPublicKeyPath),
                ) ||
                grant.payload.grantId !==
                    original.signedGrant.payload.grantId ||
                grant.payload.providerKeyId !==
                    original.signedGrant.payload.providerKeyId ||
                !grant.payload.operations.includes("cancel_request") ||
                grant.payload.operations.includes("run_inference")
            )
                throw new Error("REFRESHED_CANCEL_GRANT_REQUIRED");
            const peer = superviseJoin({
                ticket: action.descriptor.ticket,
                startupTimeoutMs: 35000,
            });
            let response;
            const proof = signDocument(
                DOMAIN.operation,
                {
                    version: 1,
                    grantId: grant.payload.grantId,
                    requestId,
                    operation: "cancel_request" as const,
                    nonce: randomUUID(),
                    payloadDigest: digest({}),
                    issuedAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                },
                privateKey,
            );
            try {
                if ((await peer.ready).kind !== "ready")
                    throw new Error("RACE_PEER_NOT_INITIALIZED");
                // Independent I/O operations begin in the same turn; no result/winner is forced.
                [, response] = await Promise.all([
                    wrapper.setHoldGenerate(false),
                    peer.request(
                        "tools/call",
                        {
                            name: "cancel_request",
                            arguments: { grant, proof, payload: {} },
                        },
                        { timeoutMs: 15000 },
                    ),
                ]);
            } finally {
                await peer.stop();
            }
            const signed = z
                .object({ structuredContent: providerResultSchema })
                .parse(response).structuredContent;
            const signature = signed.proof.payload;
            if (
                !verifyDocument(
                    DOMAIN.response,
                    signed.proof,
                    grant.payload.providerPublicKeyPem,
                ) ||
                signature.operation !== "cancel_request" ||
                signature.requestId !== requestId ||
                signature.providerId !== grant.payload.providerId ||
                signature.startupId !== grant.payload.startupId ||
                signature.nonce !== proof.payload.nonce ||
                signature.resultDigest !== digest(signed.body)
            )
                throw new Error("RACE_PROVIDER_SIGNATURE_MISMATCH");
            const winner = z
                .object({ status: z.enum(["completed", "cancelled"]) })
                .parse(signed.body).status;
            buyer = await connectBuyer(config.buyerConfigPath);
            const final = await poll(async () => {
                const r = await buyer!.call("get_request", { requestId });
                return r.receipt &&
                    r.status === winner &&
                    r.providerStatus === winner
                    ? r
                    : undefined;
            }, 180000);
            const receipt = z
                .object({
                    receiptId: z.uuid(),
                    buyerDebitAtomic: z.string(),
                    providerEarningsAtomic: z.string(),
                    feeAtomic: z.string(),
                })
                .parse(final.receipt);
            const expected =
                winner === "completed" ? String(quote.totalAtomic) : "0";
            if (
                receipt.buyerDebitAtomic !== expected ||
                BigInt(receipt.providerEarningsAtomic) +
                    BigInt(receipt.feeAtomic) !==
                    BigInt(expected)
            )
                throw new Error("RACE_RECEIPT_INCOHERENT");
            const again = await buyer.call("get_request", { requestId });
            if (
                z.object({ receiptId: z.uuid() }).parse(again.receipt)
                    .receiptId !== receipt.receiptId ||
                again.chargeAtomic !== expected
            )
                throw new Error("RACE_RECEIPT_CHANGED_ON_RETRIEVAL");
            const persisted = await inspectFixtureRequest(path, requestId);
            if (
                persisted.status !== winner ||
                persisted.settlements !== (winner === "completed" ? 1 : 0)
            )
                throw new Error("RACE_TERMINAL_NOT_SINGLE");
            cases.push({
                id: "cancel-completion-simultaneous-race-e2e",
                status: "passed",
                source: "fault_injected_cloud_one_mac",
                durationMs: Date.now() - dispatchAt,
                detail: `Real native generation finished and its response was held. After refreshing an action-only cloud grant and preconnecting the actual MCPWire peer, response release raced signed cancellation via Promise.all. Observed winner: ${winner}; exact immutable receipt charged ${expected} atomic TEST_CREDIT with ${persisted.settlements} settlement(s), then authenticated retrieval agreed. This races completed-response delivery/cancellation, not a claim of ongoing native generation.`,
                requestIds: [requestId],
                receiptIds: [receipt.receiptId],
            });
        } else {
            // Observe independently of the paid RPC: local durable state is only read, never modified.
            const statePath = env.PANAS_DATA_PATH,
                buyerKeyId = keyId(await readPrivate(owner.privateKeyPath));
            let lastHealth = held.metadataResponses;
            const record = await poll(async () => {
                if (Date.now() - dispatchAt < 55000) {
                    const s = await wrapper.snapshot();
                    lastHealth = Math.max(lastHealth, s.metadataResponses);
                }
                const row = z
                    .object({
                        status: z.string(),
                        error: z.string().optional(),
                    })
                    .parse(
                        await callDaemon(
                            join(statePath, "daemon.sock"),
                            join(statePath, "ipc-token"),
                            "get",
                            { requestId, buyerKeyId },
                        ),
                    );
                return row.status === "failed" ? row : undefined;
            }, 80000);
            const elapsed = Date.now() - dispatchAt;
            await wrapper.setHoldGenerate(false);
            if (
                record.error !== "DEADLINE_EXCEEDED" ||
                elapsed < 59000 ||
                elapsed > 75000 ||
                lastHealth <= held.metadataResponses
            )
                throw new Error("TRUE_EXECUTION_DEADLINE_NOT_ESTABLISHED");
            const result = await poll(async () => {
                const r = await buyer!.call("get_request", { requestId });
                return r.status === "failed" &&
                    r.receipt &&
                    r.providerStatus === "failed"
                    ? r
                    : undefined;
            }, 180000);
            const receipt = z
                .object({
                    receiptId: z.uuid(),
                    buyerDebitAtomic: z.literal("0"),
                    providerEarningsAtomic: z.literal("0"),
                    feeAtomic: z.literal("0"),
                })
                .parse(result.receipt);
            const persisted = await inspectFixtureRequest(path, requestId);
            if (persisted.settlements !== 0)
                throw new Error("FAILED_DEADLINE_WAS_CHARGED");
            cases.push({
                id: "deadline-e2e",
                status: "passed",
                source: "fault_injected_cloud_one_mac",
                durationMs: elapsed,
                detail: `Actual buyer MCP, cloud authorization, MCPWire and native Ollama completed generation; only its HTTP response was held. Authenticated counters observed ${held.nativeGenerationsCompleted - before.nativeGenerationsCompleted} completed native generation(s), one held response and ${lastHealth - held.metadataResponses} later metadata responses. Real ${limits.timeoutMs}ms deadline produced durable DEADLINE_EXCEEDED; signed buyer retrieval matched failed state and a zero-charge receipt with no settlement. This is transport-delay injection, not physical sleep or a stalled native model.`,
                requestIds: [requestId],
                receiptIds: [receipt.receiptId],
            });
        }
    } catch (error) {
        failed = true;
        await writeFile(
            join(config.privateDir, `deadline-failure-${runId}.private.log`),
            error instanceof Error
                ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
                : "Unknown failure",
            { mode: 0o600 },
        );
        cases.push({
            id: race
                ? "cancel-completion-simultaneous-race-e2e"
                : "deadline-e2e",
            status: "failed",
            source: "fault_injected_cloud_one_mac",
            detail: "Actual deadline seam did not complete; private diagnostics retained.",
            ...(requestId ? { requestIds: [requestId] } : {}),
        });
    } finally {
        process.off("SIGINT", signal);
        process.off("SIGTERM", signal);
        await cleanup();
    }
    cases.push(pendingPhysicalCase);
    const release = await inspectRelease(config.releaseEvidencePath);
    const ports = (
        await Promise.all([11601, 11602, 11612].map(portClosed))
    ).every(Boolean);
    const report = evidenceSchema.parse({
        version: 1,
        runId,
        mode: race ? "cancel-race-seam" : "deadline-seam",
        startedAt,
        finishedAt: new Date().toISOString(),
        gitCommit,
        sourceTreeDirty,
        ...(release.reference ? { releaseReference: release.reference } : {}),
        physicalMachineCount: 1,
        logicalProviderCount: 1,
        caseEvidence: cases,
        gates: {
            twoPhysicalMacs: "pending",
            release9: release.status,
            issue10Complete: false,
        },
        cleanup: { ownedProcessesStopped: stopped, runtimePortsClosed: ports },
    });
    const output = join(config.privateDir, `deadline-evidence-${runId}.json`);
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
    });
    if (failed || !stopped || !ports)
        throw new Error("DEADLINE_SEAM_FAILED_EVIDENCE_SAVED");
    return output;
}
