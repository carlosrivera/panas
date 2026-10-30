import { createServer } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { localConfigSchema, readPrivate } from "./config.js";
import {
    launchProvider,
    stopProvider,
    localAdmin,
    portClosed,
    repositoryRoot,
    type OwnedProvider,
} from "./processes.js";
import { assertDescendant } from "./owned-runtime.js";
import { connectBuyer } from "./mcp-client.js";
import { prepareDelayedRuntime } from "./delayed-runtime.js";
import { inspectFixtureRequest, openOperator } from "./prepare.js";
import { operationalSummary } from "../../../scripts/platform/operations.js";
import { inspectRelease } from "./release.js";

async function poll<T>(
    operation: () => Promise<T | undefined>,
    timeout = 180000,
): Promise<T> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const value = await operation();
        if (value !== undefined) return value;
        await delay(500);
    }
    throw new Error("CRASH_DRILL_OBSERVATION_TIMEOUT");
}
const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

/** One physical Mac, actual cloud/CLI/model. The observer changes stream framing only. */
export async function runCrashSeam(path: string): Promise<string> {
    const config = localConfigSchema.parse(JSON.parse(await readPrivate(path)));
    const env = parseEnv(await readPrivate(config.providerEnvs[1]));
    if (!env.PANAS_OLLAMA_BINARY || !env.PANAS_DATA_PATH)
        throw new Error("OWNER_CONFIGURATION_REQUIRED");
    const startedAt = new Date().toISOString();
    const token = randomBytes(32).toString("hex");
    let provider: OwnedProvider | undefined;
    let buyer: Awaited<ReturnType<typeof connectBuyer>> | undefined;
    let observed: Record<string, unknown> | undefined;
    let armed = false;
    let ownedWrapperPid = 0;
    let crashed = false;
    let capturedChildren: number[] = [];
    const report: Record<string, unknown> = {
        version: 1,
        mode: "live-provider-crash",
        physicalMachineCount: 1,
        startedAt,
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim(),
        sourceTreeDirty:
            execFileSync("git", ["status", "--porcelain"], {
                cwd: repositoryRoot,
                encoding: "utf8",
            }).trim().length > 0,
        release: await inspectRelease(config.releaseEvidencePath),
        injection:
            "Owned native HTTP observer requests stream=true for the armed generation; first non-final chunk triggers owner SIGKILL. No completed response is held.",
        issue10Complete: false,
    };
    const output = join(config.privateDir, "crash-evidence.json");
    const observer = createServer(async (request, response) => {
        if (
            !armed ||
            request.method !== "POST" ||
            request.url !== "/native-first-token" ||
            request.headers.authorization !== "Bearer " + token ||
            !provider?.child.pid
        ) {
            response.writeHead(403).end();
            return;
        }
        try {
            let body = "";
            for await (const chunk of request) {
                body += chunk;
                if (body.length > 2048) throw new Error("BOUNDED_OBSERVATION");
            }
            const event = JSON.parse(body);
            if (
                event.wrapperPid !== ownedWrapperPid ||
                event.nonFinal !== true ||
                !Number.isSafeInteger(event.nativePid)
            )
                throw new Error("OWNERSHIP_MISMATCH");
            assertDescendant(event.nativePid, ownedWrapperPid, (pid) =>
                Number(
                    execFileSync("ps", ["-p", String(pid), "-o", "ppid="], {
                        encoding: "utf8",
                    }).trim(),
                ),
            );
            if (
                provider.child.exitCode !== null ||
                provider.child.signalCode !== null
            )
                throw new Error("OWNER_EXITED_BEFORE_OBSERVATION");
            armed = false;
            const tree = execFileSync("ps", ["-axo", "pid=,ppid="], {
                encoding: "utf8",
            })
                .trim()
                .split("\n")
                .map((line) => line.trim().split(/\s+/).map(Number));
            const descendants = new Set([provider.child.pid]);
            for (let changed = true; changed;) {
                changed = false;
                for (const [pid, parent] of tree)
                    if (descendants.has(parent!) && !descendants.has(pid!)) {
                        descendants.add(pid!);
                        changed = true;
                    }
            }
            capturedChildren = [...descendants].filter(
                (pid) => pid !== provider!.child.pid,
            );
            const killedAt = new Date().toISOString();
            if (!provider.child.kill("SIGKILL"))
                throw new Error("OWNER_SIGNAL_FAILED");
            crashed = true;
            observed = {
                observedAt: event.observedAt,
                killedAt,
                nonFinalNativeChunk: true,
                completedNativeResponseHeld: false,
            };
            response.writeHead(200).end("{}");
        } catch {
            response.writeHead(409).end();
        }
    });
    await new Promise<void>((resolve) =>
        observer.listen(0, "127.0.0.1", resolve),
    );
    const address = observer.address() as { port: number };
    const wrapper = await prepareDelayedRuntime({
        privateDir: config.privateDir,
        binary: env.PANAS_OLLAMA_BINARY,
        externalPort: 11602,
        upstreamPort: 11612,
        firstTokenObserver: {
            url: `http://127.0.0.1:${address.port}/native-first-token`,
            token,
        },
    });
    const discover = async () => {
        try {
            const status = (await localAdmin(provider!, "status")) as {
                state: string;
                startupId: string;
            };
            if (status.state !== "ready") return undefined;
            const listing = await buyer!.call("discover_providers", {
                readyOnly: true,
                limit: 50,
            });
            return (
                listing.providers as {
                    providerId: string;
                    startupId: string;
                    readiness: { ready: boolean };
                }[]
            ).some(
                (p) =>
                    p.providerId === config.providerIds[1] &&
                    p.startupId === status.startupId &&
                    p.readiness.ready,
            )
                ? true
                : undefined;
        } catch {
            return undefined;
        }
    };
    const execute = async (
        prompt: string,
        maxOutputTokens: number,
        interrupt = false,
    ) => {
        const quote = await buyer!.call("quote_inference", {
            providerId: config.providerIds[1],
            prompt,
            maxOutputTokens,
        });
        const purchase = await buyer!.call("purchase_access", {
            quoteId: quote.quoteId,
            idempotencyKey: randomUUID(),
        });
        const id = String(purchase.requestId);
        if (interrupt) report.interruptedRequestId = id;
        try {
            await buyer!.call("run_inference", { requestId: id });
        } catch (error) {
            if (!interrupt || (error as { code?: string }).code !== "UNCERTAIN")
                throw error;
        }
        return id;
    };
    const readyResult = async (id: string) =>
        poll(async () => {
            const value = await buyer!.call("get_request", { requestId: id });
            return value.status === "completed" && value.receipt
                ? value
                : undefined;
        });
    try {
        const baseline = await inspectFixtureRequest(path, randomUUID());
        report.baseline = baseline;
        if (baseline.held !== "0") throw new Error("FIXTURE_HAS_PRIOR_HOLDS");
        provider = await launchProvider(config.providerEnvs[1], {
            PANAS_OLLAMA_BINARY: wrapper.binaryPath,
        });
        buyer = await connectBuyer(config.buyerConfigPath);
        await poll(discover);
        const before = (await localAdmin(provider, "status")) as {
            startupId: string;
        };
        report.originalStartup = before.startupId;
        const completedId = await execute("Reply with hello pana.", 16);
        const completed = await readyResult(completedId);
        report.completedControl = {
            requestId: completedId,
            receipt: completed.receipt,
            chargeAtomic: completed.chargeAtomic,
        };
        const dataPath = env.PANAS_DATA_PATH;
        const keyBefore = hash(
            await readFile(join(dataPath, "requests", "key")),
        );
        const nonceKeyBefore = hash(
            await readFile(join(dataPath, "nonces", "key")),
        );
        const completedBytes = hash(
            await readFile(join(dataPath, "requests", completedId + ".enc")),
        );
        const listener = execFileSync(
            "lsof",
            ["-nP", "-tiTCP:11602", "-sTCP:LISTEN"],
            { encoding: "utf8" },
        ).trim();
        if (!/^\d+$/.test(listener))
            throw new Error("AMBIGUOUS_WRAPPER_LISTENER");
        ownedWrapperPid = Number(listener);
        assertDescendant(ownedWrapperPid, provider.child.pid!, (pid) =>
            Number(
                execFileSync("ps", ["-p", String(pid), "-o", "ppid="], {
                    encoding: "utf8",
                }).trim(),
            ),
        );
        const command = execFileSync(
            "ps",
            ["-p", String(ownedWrapperPid), "-o", "command="],
            { encoding: "utf8" },
        ).trim();
        if (
            ![
                `${process.execPath} ${wrapper.binaryPath} serve`,
                `node ${wrapper.binaryPath} serve`,
            ].includes(command)
        )
            throw new Error("WRAPPER_COMMAND_MISMATCH");
        const ownerRecord = JSON.parse(
            await readPrivate(join(dataPath, "host.owner.json")),
        );
        if (ownerRecord.pid !== provider.child.pid)
            throw new Error("OWNER_RECORD_MISMATCH");
        await wrapper.observeNextGeneration(true);
        armed = true;
        const interruptedId = await execute(
            "Write integers from 1 to 200, each on a new line. Continue until 200. Start now:\n1",
            128,
            true,
        );
        report.interruptedRequestId = interruptedId;
        await poll(async () => observed, 20000);
        report.crashObservation = observed;
        await poll(
            async () =>
                provider!.child.signalCode === "SIGKILL" ? true : undefined,
            10000,
        );
        provider.stopped = true;
        await poll(
            async () =>
                (await portClosed(11602)) && (await portClosed(11612))
                    ? true
                    : undefined,
            15000,
        );
        report.ownedRuntimePortsClosedAfterCrash = true;
        await poll(
            async () =>
                capturedChildren.every((pid) => {
                    try {
                        process.kill(pid, 0);
                        return false;
                    } catch (error) {
                        return (
                            (error as NodeJS.ErrnoException).code === "ESRCH"
                        );
                    }
                })
                    ? true
                    : undefined,
            15000,
        );
        report.capturedDescendantsStopped = capturedChildren.length;
        const interruptedCloud = await inspectFixtureRequest(
            path,
            interruptedId,
        );
        if (
            interruptedCloud.status !== "authorized" ||
            interruptedCloud.settlements !== 0
        )
            throw new Error(
                "CRASH_DID_NOT_INTERRUPT_AUTHORIZED_UNSETTLED_WORK",
            );
        report.beforeRestart = interruptedCloud;
        await buyer.close();
        buyer = undefined;
        await wrapper.observeNextGeneration(false);
        provider = await launchProvider(config.providerEnvs[1], {
            PANAS_OLLAMA_BINARY: wrapper.binaryPath,
        });
        buyer = await connectBuyer(config.buyerConfigPath);
        await poll(discover);
        const after = (await localAdmin(provider, "status")) as {
            startupId: string;
            peerProbe: { status: string };
        };
        if (
            after.startupId === before.startupId ||
            after.peerProbe.status !== "verified"
        )
            throw new Error("RECOVERY_NOT_RETESTED");
        report.recoveredStartup = after.startupId;
        const pending = await poll(async () => {
            const value = await buyer!.call("get_request", {
                requestId: interruptedId,
            });
            return value.status === "pending" &&
                value.providerStatus === "unknown"
                ? value
                : undefined;
        });
        report.retrieval = {
            status: pending.status,
            providerStatus: pending.providerStatus,
            receipt: pending.receipt ?? null,
        };
        if (
            keyBefore !==
                hash(await readFile(join(dataPath, "requests", "key"))) ||
            nonceKeyBefore !==
                hash(await readFile(join(dataPath, "nonces", "key"))) ||
            completedBytes !==
                hash(
                    await readFile(
                        join(dataPath, "requests", completedId + ".enc"),
                    ),
                )
        )
            throw new Error("DURABLE_STATE_CHANGED");
        report.encryptionAndCompletedBytesPreserved = true;
        const recoveredCompleted = await readyResult(completedId);
        if (
            JSON.stringify(recoveredCompleted.receipt) !==
            JSON.stringify(completed.receipt)
        )
            throw new Error("COMPLETED_RECEIPT_CHANGED");
        const replayBefore = await wrapper.snapshot();
        let replay = "";
        try {
            await buyer.call("run_inference", { requestId: interruptedId });
        } catch (error) {
            replay = (error as { code?: string }).code ?? "REJECTED";
        }
        if (replay !== "UNCERTAIN") throw new Error("BUYER_REPLAY_NOT_BLOCKED");
        const replayAfter = await wrapper.snapshot();
        if (
            replayAfter.nativeGenerationsCompleted !==
            replayBefore.nativeGenerationsCompleted
        )
            throw new Error("INFERENCE_REPLAYED");
        report.buyerReplayRejected = replay;
        const fresh = await execute("Reply with the word recovered.", 16);
        const result = await readyResult(fresh);
        report.freshWork = {
            requestId: fresh,
            receipt: result.receipt,
            chargeAtomic: result.chargeAtomic,
        };
        report.pendingAfterRecovery = await inspectFixtureRequest(
            path,
            interruptedId,
        );
        if (
            (report.pendingAfterRecovery as { settlements: number })
                .settlements !== 0
        )
            throw new Error("UNKNOWN_WORK_SETTLED");
        const op = await openOperator(config.operatorEnvPath);
        try {
            const client = await op.pool.connect();
            try {
                report.operationalHealth = await operationalSummary(
                    client,
                    report.sourceCommit as string,
                );
            } finally {
                client.release();
            }
        } finally {
            await op.pool.end();
        }
        report.status = "passed_with_unknown_pending_reconciliation";
    } catch (error) {
        report.status = "failed";
        report.failure = /^[A-Z_]+$/.test((error as Error).message)
            ? (error as Error).message
            : "LIVE_DRILL_FAILED";
        throw error;
    } finally {
        armed = false;
        let cleaned = true;
        try {
            await wrapper.observeNextGeneration(false);
        } catch {
            cleaned = false;
        }
        try {
            await buyer?.close();
        } catch {
            cleaned = false;
        }
        try {
            if (provider && !provider.stopped) await stopProvider(provider);
        } catch {
            cleaned = false;
        }
        try {
            await wrapper.close();
        } catch {
            cleaned = false;
        }
        observer.closeAllConnections();
        await new Promise<void>((resolve) => observer.close(() => resolve()));
        report.cleanup = {
            ownedProcessesStopped: cleaned,
            portsClosed: (await portClosed(11602)) && (await portClosed(11612)),
            crashed,
        };
        report.finishedAt = new Date().toISOString();
        await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
            mode: 0o600,
        });
    }
    return output;
}
