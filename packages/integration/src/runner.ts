import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
    localConfigSchema,
    manualConfigSchema,
    readPrivate,
    privateDirectory,
    type LocalConfig,
    type ManualConfig,
} from "./config.js";
import { connectBuyer, ToolFailure } from "./mcp-client.js";
import {
    evidenceSchema,
    pendingPhysicalCase,
    type CaseEvidence,
} from "./evidence.js";
import {
    launchProvider,
    stopProvider,
    localAdmin,
    portClosed,
    repositoryRoot,
    type OwnedProvider,
} from "./processes.js";
import { prepareRaceBuyer, inspectFixtureRequest } from "./prepare.js";
import { startFaultProxy } from "./fault-proxy.js";
import { privateWrite } from "./config.js";
import { inspectRelease } from "./release.js";

const publicProviderSchema = z.object({
    providerId: z.uuid(),
    model: z.object({ name: z.string(), digest: z.string().nullable() }),
    profile: z.object({
        maxOutputTokens: z.number(),
        maxContextTokens: z.number(),
    }),
    price: z.object({ totalAtomic: z.string() }),
    readiness: z.object({ ready: z.boolean(), reason: z.string() }),
});
type Buyer = Awaited<ReturnType<typeof connectBuyer>>;
async function poll<T>(
    action: () => Promise<T | undefined>,
    timeoutMs = 180000,
): Promise<T> {
    const until = Date.now() + timeoutMs;
    do {
        try {
            const result = await action();
            if (result !== undefined) return result;
        } catch (error) {
            if (
                !(error instanceof ToolFailure) ||
                !["UNAVAILABLE", "PROVIDER_UNAVAILABLE", "UNCERTAIN"].includes(
                    error.code,
                )
            )
                throw error;
        }
        await delay(1000);
    } while (Date.now() < until);
    throw new Error("OBSERVATION_TIMEOUT");
}
async function ownedDiscovery(buyer: Buyer, ids: string[], readyOnly: boolean) {
    const result = await buyer.call("discover_providers", {
        model: "qwen2.5:0.5b",
        readyOnly,
        limit: 50,
    });
    return z
        .array(publicProviderSchema)
        .parse(result.providers)
        .filter((p) => ids.includes(p.providerId));
}
async function completed(buyer: Buyer, requestId: string) {
    return poll(async () => {
        const result = await buyer.call("get_request", { requestId });
        return result.receipt && result.status === "completed"
            ? result
            : undefined;
    });
}
function receipt(result: Record<string, unknown>) {
    const r = z
        .object({
            receiptId: z.uuid(),
            requestId: z.uuid(),
            buyerDebitAtomic: z.string(),
            providerEarningsAtomic: z.string(),
            feeAtomic: z.string(),
            currency: z.literal("TEST_CREDIT"),
        })
        .parse(result.receipt);
    if (
        BigInt(r.buyerDebitAtomic) !==
        BigInt(r.providerEarningsAtomic) + BigInt(r.feeAtomic)
    )
        throw new Error("UNBALANCED_RECEIPT");
    return r;
}
async function buy(
    buyer: Buyer,
    providerId: string,
    prompt = "Reply with hello pana.",
    maxOutputTokens = 16,
) {
    const quote = await buyer.call("quote_inference", {
        providerId,
        prompt,
        maxOutputTokens,
    });
    const key = randomUUID();
    const args = { quoteId: String(quote.quoteId), idempotencyKey: key };
    const purchase = await buyer.call("purchase_access", args);
    return { quote, purchase, args, requestId: String(purchase.requestId) };
}

export async function run(
    path: string,
    manual = false,
    smokeOnly = false,
): Promise<string> {
    const config: LocalConfig | ManualConfig = manual
        ? manualConfigSchema.parse(JSON.parse(await readPrivate(path)))
        : localConfigSchema.parse(JSON.parse(await readPrivate(path)));
    if (
        smokeOnly &&
        (await inspectRelease(config.releaseEvidencePath)).status !==
            "referenced_verified_report"
    )
        throw new Error("VERIFIED_RELEASE_REFERENCE_REQUIRED");
    await privateDirectory(config.privateDir);
    const runId = randomUUID(),
        startedAt = new Date().toISOString(),
        cases: CaseEvidence[] = [];
    const owned: OwnedProvider[] = [];
    const clients: Buyer[] = [];
    let buyer: Buyer | undefined;
    let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
    let ownerPath = config.buyerConfigPath;
    let cleanupStopped = true,
        cleanupPorts = true;
    const ids =
        config.mode === "local-simulation"
            ? config.providerIds
            : config.physicalHosts.map((h) => h.providerId);
    const mark = (
        id: string,
        detail: string,
        requestIds?: string[],
        receiptIds?: string[],
        source?: CaseEvidence["source"],
    ) =>
        cases.push({
            id,
            status: "passed",
            source:
                source ??
                (manual ? "operator_attested_two_mac" : "real_cloud_one_mac"),
            detail,
            ...(requestIds ? { requestIds } : {}),
            ...(receiptIds ? { receiptIds } : {}),
        });
    let failed = false;
    let stopping = false;
    let cleanupPromise: Promise<void> | undefined;
    const sourceTreeDirty =
        execFileSync("git", ["status", "--porcelain"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim().length > 0;
    const cleanup = (): Promise<void> =>
        (cleanupPromise ??= (async () => {
            stopping = true;
            proxy?.setFaults({
                newPurchases: false,
                terminal: false,
                authorize: false,
            });
            await Promise.all(
                clients.map((client) =>
                    client.close().catch(() => {
                        cleanupStopped = false;
                    }),
                ),
            );
            await Promise.all(
                owned.map((provider) =>
                    stopProvider(provider).catch(() => {
                        cleanupStopped = false;
                    }),
                ),
            );
            if (proxy)
                await proxy.close().catch(() => {
                    cleanupStopped = false;
                });
            if (config.mode === "local-simulation")
                cleanupPorts = (
                    await Promise.all(config.runtimePorts.map(portClosed))
                ).every(Boolean);
        })());
    const onSignal = () => {
        void cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
        if (config.mode === "local-simulation" && !smokeOnly) {
            proxy = await startFaultProxy({
                upstream: config.accountingUrl,
                privateDir: config.privateDir,
            });
            const owner = JSON.parse(
                await readPrivate(config.buyerConfigPath),
            ) as Record<string, unknown>;
            ownerPath = join(config.privateDir, "buyer-proxy.json");
            await privateWrite(
                ownerPath,
                JSON.stringify({ ...owner, accountingUrl: proxy.url }, null, 2),
            );
            for (const env of config.providerEnvs) {
                if (stopping) throw new Error("RUN_STOPPED");
                owned.push(
                    await launchProvider(env, {
                        PANAS_ACCOUNTING_URL: proxy.url,
                        NODE_EXTRA_CA_CERTS: proxy.caPath,
                    }),
                );
            }
        }
        if (config.mode === "local-simulation" && smokeOnly)
            for (const env of config.providerEnvs)
                owned.push(await launchProvider(env));
        if (stopping) throw new Error("RUN_STOPPED");
        buyer = await connectBuyer(ownerPath, proxy?.caPath);
        clients.push(buyer);
        const providers = await poll(async () => {
            const list = await ownedDiscovery(buyer!, ids, true);
            return list.length === 2 ? list : undefined;
        });
        mark(
            "startup-ready-discovery",
            manual
                ? "Two operator-attested physical hosts published fresh readiness and were discovered by the buyer MCP facade."
                : "Two real provider processes on one physical Mac published startup-tested readiness through the cloud registry.",
        );
        const selected = [...providers].sort((a, b) =>
            BigInt(a.price.totalAtomic) < BigInt(b.price.totalAtomic) ? -1 : 1,
        )[0]!;
        if (
            config.mode === "local-simulation" &&
            (selected.providerId !== config.providerIds[0] ||
                selected.price.totalAtomic !== "1")
        )
            throw new Error("CHEAPEST_PROVIDER_NOT_SELECTED");
        if (
            selected.profile.maxOutputTokens < 16 ||
            selected.profile.maxContextTokens < 128
        )
            throw new Error("PROFILE_INCOMPATIBLE");
        mark(
            "price-profile-selection",
            "Buyer queried live readiness/model/profile and selected the lowest listed fixed provider price among this run's two providers.",
        );
        const paid = await buy(buyer, selected.providerId);
        const duplicate = await buyer.call("purchase_access", paid.args);
        if (duplicate.requestId !== paid.requestId)
            throw new Error("DUPLICATE_PURCHASE_CREATED_REQUEST");
        await buyer.call("run_inference", { requestId: paid.requestId });
        await buyer.close();
        buyer = await connectBuyer(ownerPath, proxy?.caPath);
        clients.push(buyer);
        const result = await completed(buyer, paid.requestId),
            proof = receipt(result);
        if (proof.buyerDebitAtomic !== String(paid.quote.totalAtomic))
            throw new Error("FIXED_PRICE_CHANGED");
        mark(
            "paid-inference-receipt",
            "Actual buyer MCP → registry/accounting → MCPWire → pinned Ollama completed with a balanced fixed-price receipt and authenticated retrieval.",
            [paid.requestId],
            [proof.receiptId],
        );
        const diagnostic = z
            .object({
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
                finishReason: z.enum(["stop", "length", "unknown"]).optional(),
            })
            .parse(result.result);
        cases.at(-1)!.metrics = {
            buyerDebitAtomic: proof.buyerDebitAtomic,
            providerEarningsAtomic: proof.providerEarningsAtomic,
            feeAtomic: proof.feeAtomic,
            inputTokens: diagnostic.inputTokens,
            outputTokens: diagnostic.outputTokens,
            finishReason: diagnostic.finishReason ?? "unknown",
        };
        mark(
            "buyer-adapter-disconnect",
            "Buyer MCP adapter was closed after dispatch and replaced; retrieval used the original request. The fast model may have completed before disconnect.",
            [paid.requestId],
            [proof.receiptId],
        );
        try {
            await buyer.call("run_inference", { requestId: paid.requestId });
            throw new Error("DUPLICATE_EXECUTION_ACCEPTED");
        } catch (error) {
            if (!(error instanceof ToolFailure) || error.code !== "UNCERTAIN")
                throw error;
        }
        const reread = receipt(await completed(buyer, paid.requestId));
        if (
            reread.receiptId !== proof.receiptId ||
            reread.buyerDebitAtomic !== proof.buyerDebitAtomic
        )
            throw new Error("DUPLICATE_DEBIT");
        mark(
            "duplicate-purchase-and-execution",
            "Repeated purchase key kept the request; repeated execution was rejected. Fresh-peer retrieval retained the exact receipt and debit.",
            [paid.requestId],
            [proof.receiptId],
        );
        if (config.mode === "manual-two-machine") {
            for (const provider of providers.filter(
                (p) => p.providerId !== selected.providerId,
            )) {
                const second = await buy(buyer, provider.providerId);
                await buyer.call("run_inference", {
                    requestId: second.requestId,
                });
                const secondReceipt = receipt(
                    await completed(buyer, second.requestId),
                );
                mark(
                    "second-physical-host-inference",
                    "A second distinct operator-attested host produced its own verified result and balanced receipt.",
                    [second.requestId],
                    [secondReceipt.receiptId],
                );
            }
        } else if (!smokeOnly) {
            if (!proxy) throw new Error("FAULT_PROXY_MISSING");
            const interruptedQuote = await buyer.call("quote_inference", {
                providerId: selected.providerId,
                prompt: "Reply with ready.",
                maxOutputTokens: 8,
            });
            const interruptedRequest = String(interruptedQuote.requestId),
                interruptedArgs = {
                    quoteId: String(interruptedQuote.quoteId),
                    idempotencyKey: randomUUID(),
                };
            const beforeFailure = await inspectFixtureRequest(
                path,
                interruptedRequest,
            );
            proxy.setFaults({ newPurchases: true });
            try {
                await buyer.call("purchase_access", interruptedArgs);
                throw new Error("FAULTED_PURCHASE_SUCCEEDED");
            } catch (error) {
                if (
                    !(error instanceof ToolFailure) ||
                    error.code !== "UNAVAILABLE"
                )
                    throw error;
            }
            const afterFailure = await inspectFixtureRequest(
                path,
                interruptedRequest,
            );
            if (
                afterFailure.requestExists ||
                afterFailure.settlements !== 0 ||
                afterFailure.held !== beforeFailure.held ||
                afterFailure.balance !== beforeFailure.balance ||
                proxy.snapshot().blockedNewPurchases < 1
            )
                throw new Error("FAULTED_PURCHASE_CHANGED_ACCOUNTING");
            proxy.setFaults({ newPurchases: false });
            const recovered = await buyer.call(
                "purchase_access",
                interruptedArgs,
            );
            await buyer.call("run_inference", {
                requestId: String(recovered.requestId),
            });
            const recoveredReceipt = receipt(
                await completed(buyer, String(recovered.requestId)),
            );
            mark(
                "controlled-purchase-outage",
                "Isolated HTTPS transport proxy returned503 before forwarding this owner's purchase. Cloud had no request/reservation/settlement and unchanged balance/hold; recovery reused the original key and settled once.",
                [String(recovered.requestId)],
                [recoveredReceipt.receiptId],
                "fault_injected_cloud_one_mac",
            );
            proxy.setFaults({ terminal: true });
            const held = await buy(
                buyer,
                selected.providerId,
                "Reply with hello pana.",
                32,
            );
            await buyer.call("run_inference", { requestId: held.requestId });
            await poll(async () => {
                const state = await buyer!.call("get_request", {
                    requestId: held.requestId,
                });
                return state.providerStatus === "completed" &&
                    state.receipt === null &&
                    proxy!.snapshot().blockedTerminal > 0
                    ? true
                    : undefined;
            });
            const pending = await inspectFixtureRequest(path, held.requestId);
            if (
                pending.status !== "authorized" ||
                pending.hasReceipt ||
                pending.settlements !== 0
            )
                throw new Error("BLOCKED_OUTBOX_SETTLED_EARLY");
            proxy.setFaults({ terminal: false });
            const reconciled = receipt(await completed(buyer, held.requestId)),
                confirmed = await inspectFixtureRequest(path, held.requestId);
            if (confirmed.settlements !== 1)
                throw new Error("OUTBOX_RETRY_SETTLED_MORE_THAN_ONCE");
            mark(
                "controlled-terminal-outage",
                "Actual reserved authorization and Ollama inference completed while this run's isolated HTTPS proxy blocked terminal delivery. Cloud remained authorized with no receipt/settlement; restoring delivery reconciled the durable outbox exactly once.",
                [held.requestId],
                [reconciled.receiptId],
                "fault_injected_cloud_one_mac",
            );
            const raceConfigs = await prepareRaceBuyer(
                path,
                String(paid.quote.totalAtomic),
            );
            const racers = await Promise.all(
                raceConfigs.map((p) => connectBuyer(p)),
            );
            clients.push(...racers);
            const quotes = await Promise.all(
                racers.map((b) =>
                    b.call("quote_inference", {
                        providerId: selected.providerId,
                        prompt: "Reply with ready.",
                        maxOutputTokens: 8,
                    }),
                ),
            );
            const purchases = await Promise.allSettled(
                racers.map((b, i) =>
                    b.call("purchase_access", {
                        quoteId: String(quotes[i]!.quoteId),
                        idempotencyKey: randomUUID(),
                    }),
                ),
            );
            const winners = purchases.flatMap((p, i) =>
                p.status === "fulfilled"
                    ? [
                          {
                              buyer: racers[i]!,
                              requestId: String(p.value.requestId),
                          },
                      ]
                    : [],
            );
            if (winners.length !== 1)
                throw new Error("CONCURRENT_SPENDING_NOT_SERIALIZED");
            const losers = purchases.filter(
                (p): p is PromiseRejectedResult => p.status === "rejected",
            );
            if (
                losers.length !== 1 ||
                !(losers[0]!.reason instanceof ToolFailure) ||
                losers[0]!.reason.code !== "SPENDING_LIMIT"
            )
                throw new Error("RACE_LOSER_WAS_NOT_SPENDING_LIMIT");
            const win = winners[0]!;
            await win.buyer.call("run_inference", { requestId: win.requestId });
            const raceReceipt = receipt(
                await completed(win.buyer, win.requestId),
            );
            mark(
                "concurrent-cloud-spending",
                "Two separate buyer MCP processes raced purchases against one owner/session/balance cap. Exactly one reserved and executed; one was rejected.",
                [win.requestId],
                [raceReceipt.receiptId],
            );
            const index = config.providerIds.indexOf(selected.providerId);
            if (index < 0) throw new Error("UNKNOWN_OWNED_PROVIDER");
            await localAdmin(owned[index]!, "pause");
            const fallback = await poll(async () => {
                const list = await ownedDiscovery(buyer!, ids, true);
                return list.length === 1 &&
                    list[0]!.providerId !== selected.providerId
                    ? list[0]
                    : undefined;
            });
            const alternative = await buy(buyer, fallback.providerId);
            await buyer.call("run_inference", {
                requestId: alternative.requestId,
            });
            const alternativeReceipt = receipt(
                await completed(buyer, alternative.requestId),
            );
            mark(
                "pause-and-provider-fallback",
                "The selected provider was paused through private local administration; cloud discovery excluded it and the buyer completed a new request on the other process.",
                [alternative.requestId],
                [alternativeReceipt.receiptId],
            );
            await stopProvider(owned[index]!);
            await poll(async () => {
                const list = await ownedDiscovery(buyer!, ids, false);
                return list.find((p) => p.providerId === selected.providerId)
                    ?.readiness.reason === "heartbeat_expired"
                    ? true
                    : undefined;
            }, 75000);
            const stillReady = await ownedDiscovery(buyer, ids, true);
            if (
                !stillReady.some(
                    (provider) => provider.providerId === fallback.providerId,
                )
            )
                throw new Error("FALLBACK_NOT_FRESH");
            mark(
                "heartbeat-expiry",
                "Stopped owned provider expired from cloud readiness under the configured heartbeat TTL; the second provider remained independent.",
            );
        }
    } catch (error) {
        failed = true;
        cases.push({
            id: "run-failure",
            status: "failed",
            source: manual ? "operator_attested_two_mac" : "real_cloud_one_mac",
            detail:
                error instanceof ToolFailure
                    ? error.code
                    : "INTEGRATION_OBSERVATION_FAILED",
        });
    } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await cleanup();
    }
    if (!manual) cases.push(pendingPhysicalCase);
    for (const id of [
        "ticket-and-grant-negative-e2e",
        "queue-overflow-e2e",
        "cancel-completion-race-e2e",
        "deadline-e2e",
        "provider-crash-e2e",
        "sleep-wake-e2e",
        "volcano-outage-e2e",
    ])
        cases.push({
            id,
            status: "not_run",
            source: manual ? "operator_attested_two_mac" : "real_cloud_one_mac",
            detail: "No actual end-to-end fault observation recorded by this run. Owning-package injected checks belong to the separate component_fixture artifact and do not complete this gate.",
        });
    const release = await inspectRelease(config.releaseEvidencePath);
    const artifact = evidenceSchema.parse({
        version: 1,
        runId,
        mode: smokeOnly ? "release-smoke" : config.mode,
        startedAt,
        finishedAt: new Date().toISOString(),
        gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim(),
        ...(release.reference ? { releaseReference: release.reference } : {}),
        sourceTreeDirty,
        physicalMachineCount: config.physicalMachineCount,
        logicalProviderCount: 2,
        caseEvidence: cases,
        gates: {
            twoPhysicalMacs:
                manual && !failed ? "passed_operator_attested" : "pending",
            release9: release.status,
            issue10Complete: false,
        },
        cleanup: {
            ownedProcessesStopped: cleanupStopped,
            runtimePortsClosed: cleanupPorts,
        },
    });
    const output = join(config.privateDir, `evidence-${runId}.json`);
    await writeFile(output, JSON.stringify(artifact, null, 2) + "\n", {
        mode: 0o600,
    });
    if (failed || !cleanupStopped || !cleanupPorts)
        throw new Error("INTEGRATION_RUN_FAILED_EVIDENCE_SAVED");
    return output;
}
