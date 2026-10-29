import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { keyId } from "@panas/protocol";
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
export async function runDeadlineSeam(path: string): Promise<string> {
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
                .object({ status: z.string(), error: z.string().optional() })
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
            id: "deadline-e2e",
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
        mode: "deadline-seam",
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
