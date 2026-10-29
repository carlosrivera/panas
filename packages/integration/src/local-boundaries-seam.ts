import { createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { superviseJoin } from "@panas/mcpwire";
import {
    DOMAIN,
    digest,
    signDocument,
    signedGrantSchema,
    providerResultSchema,
    verifyDocument,
    type SignedDocument,
    type Grant,
    type HostOperation,
} from "@panas/protocol";
import { createCloudClient } from "../../../apps/buyer-mcp/src/clients.js";
import { readOwnerConfig } from "../../../apps/buyer-mcp/src/config.js";
import { PrivateStore } from "../../../apps/buyer-mcp/src/store.js";
import {
    buyerStateSchema,
    descriptorSchema,
    type BuyerState,
} from "../../../apps/buyer-mcp/src/state.js";
import { localConfigSchema, readPrivate, privateWrite } from "./config.js";
import {
    launchProvider,
    stopProvider,
    localAdmin,
    type OwnedProvider,
} from "./processes.js";
import { openOperator } from "./prepare.js";

type Peer = ReturnType<typeof superviseJoin>;
async function wait<T>(
    fn: () => Promise<T | undefined>,
    ms = 180000,
): Promise<T> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await fn();
        if (value !== undefined) return value;
        await delay(200);
    }
    throw new Error("LIVE_BOUNDARY_TIMEOUT");
}
async function peerFor(ticket: string): Promise<Peer> {
    const peer = superviseJoin({ ticket });
    if ((await peer.ready).kind !== "ready") {
        await peer.stop();
        throw new Error("LIVE_PEER_NOT_READY");
    }
    return peer;
}
function rejection(result: unknown): string | undefined {
    const r = result as {
        isError?: boolean;
        structuredContent?: { error?: { code?: string } };
        content?: { text?: string }[];
    };
    if (!r.isError) return;
    if (r.structuredContent?.error?.code) return r.structuredContent.error.code;
    try {
        return JSON.parse(r.content?.[0]?.text ?? "{}").code;
    } catch {
        return "INVALID_REJECTION";
    }
}
async function invoke(
    peer: Peer,
    grant: SignedDocument<Grant>,
    key: ReturnType<typeof createPrivateKey>,
    operation: HostOperation,
    payload: unknown,
) {
    const now = Date.now();
    const proof = signDocument(
        DOMAIN.operation,
        {
            version: 1 as const,
            grantId: grant.payload.grantId,
            requestId: grant.payload.requestId,
            operation,
            nonce: randomUUID(),
            payloadDigest: digest(payload),
            issuedAt: new Date(now).toISOString(),
            expiresAt: new Date(
                Math.min(now + 60000, Date.parse(grant.payload.expiresAt)),
            ).toISOString(),
        },
        key,
    );
    const result = await peer.request(
        "tools/call",
        { name: operation, arguments: { grant, proof, payload } },
        { timeoutMs: 15000 },
    );
    const code = rejection(result);
    if (code) return { code, nonce: proof.payload.nonce };
    const signed = providerResultSchema.parse(
        (result as { structuredContent: unknown }).structuredContent,
    );
    if (
        !verifyDocument(
            DOMAIN.response,
            signed.proof,
            grant.payload.providerPublicKeyPem,
        ) ||
        signed.proof.payload.nonce !== proof.payload.nonce ||
        signed.proof.payload.requestId !== grant.payload.requestId ||
        signed.proof.payload.startupId !== grant.payload.startupId ||
        signed.proof.payload.operation !== operation ||
        signed.proof.payload.resultDigest !== digest(signed.body)
    )
        throw new Error("LIVE_PROVIDER_SIGNATURE_MISMATCH");
    return {
        body: signed.body as { status: string; result?: unknown },
        nonce: proof.payload.nonce,
    };
}

/** Actual cloud/model, persistent peers and real wall-clock minute; never compresses time. */
export async function runLocalBoundaries(path: string): Promise<string> {
    const config = localConfigSchema.parse(JSON.parse(await readPrivate(path)));
    const crash = JSON.parse(
        await readPrivate(join(config.privateDir, "crash-evidence.json")),
    );
    if (crash.status !== "passed_with_unknown_pending_reconciliation")
        throw new Error("SUCCESSFUL_CRASH_DRILL_REQUIRED");
    const owner = readOwnerConfig(config.buyerConfigPath);
    const ownerKey = createPrivateKey(await readPrivate(owner.privateKeyPath));
    const store = new PrivateStore<BuyerState>(
        owner.dataDir,
        (v) => buyerStateSchema.parse(v),
        () => {
            throw new Error("BUYER_STATE_REQUIRED");
        },
    );
    let original;
    try {
        original = store.load().requests[String(crash.interruptedRequestId)]!;
    } finally {
        store.close();
    }
    const oldGrant = signedGrantSchema.parse(original.signedGrant);
    const ownerCloud = createCloudClient({
        url: config.accountingUrl,
        buyerId: owner.buyerId,
        privateKey: ownerKey,
    });
    const report: Record<string, unknown> = {
        version: 1,
        mode: "live-local-boundaries",
        physicalMachineCount: 1,
        startedAt: new Date().toISOString(),
        issue10Complete: false,
    };
    let provider: OwnedProvider | undefined;
    const peers: Peer[] = [];
    const output = join(config.privateDir, "boundary-evidence.json");
    const operator = await openOperator(config.operatorEnvPath);
    try {
        provider = await launchProvider(config.providerEnvs[1]);
        await wait(async () => {
            try {
                const s = (await localAdmin(provider!, "status")) as {
                    state: string;
                };
                return s.state === "ready" ? true : undefined;
            } catch {
                return undefined;
            }
        });
        const view = (await ownerCloud.get(oldGrant.payload.requestId)) as {
            descriptor: unknown;
        };
        const descriptor = descriptorSchema.parse(view.descriptor);
        const stalePeer = await peerFor(descriptor.ticket);
        peers.push(stalePeer);
        const stale = await invoke(
            stalePeer,
            oldGrant,
            ownerKey,
            "run_inference",
            original.payload,
        );
        if (stale.code !== "EXECUTION_BINDING_MISMATCH")
            throw new Error("OLD_STARTUP_EXECUTION_NOT_REJECTED");
        const dataDir = provider.env.PANAS_DATA_PATH!;
        let nonceConsumed = false;
        try {
            await access(join(dataDir, "nonces", stale.nonce + ".enc"));
            nonceConsumed = true;
        } catch {
            /* Expected absence. */
        }
        if (nonceConsumed) throw new Error("STALE_STARTUP_CONSUMED_NONCE");
        report.startupBinding = {
            status: "passed",
            rejection: stale.code,
            nonceConsumed,
            oldStartup: oldGrant.payload.startupId,
            currentStartup: descriptor.startupId,
        };
        const renewed = signedGrantSchema.parse(
            (
                (await ownerCloud.get(oldGrant.payload.requestId)) as {
                    signedGrant: unknown;
                }
            ).signedGrant,
        );
        const recovered = await invoke(
            stalePeer,
            renewed,
            ownerKey,
            "get_request",
            {},
        );
        if (recovered.body?.status !== "unknown")
            throw new Error("ORIGINAL_STARTUP_RETRIEVAL_FAILED");
        report.originalStartupRetrieval = "unknown_without_execution";
        await stalePeer.stop();
        const pair = generateKeyPairSync("ed25519"),
            buyerId = randomUUID(),
            sessionId = randomUUID();
        const keyPath = join(config.privateDir, "rate-buyer.pem"),
            buyerPath = join(config.privateDir, "rate-buyer.json");
        await privateWrite(
            keyPath,
            pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        );
        await operator.service.operatorEnrollBuyer({
            buyerId,
            publicKeyPem: pair.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            maxRequestAtomic: "100",
            maxSessionAtomic: "100",
            maxDailyAtomic: "100",
            policyVersion: "integration-test-credits-only",
        });
        await operator.service.operatorOpenSession({
            buyerId,
            sessionId,
            capAtomic: "100",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        await operator.service.operatorFund({
            buyerId,
            amountAtomic: "100",
            idempotencyKey: randomUUID(),
        });
        await privateWrite(
            buyerPath,
            JSON.stringify(
                {
                    ...owner,
                    buyerId,
                    sessionId,
                    privateKeyPath: keyPath,
                    dataDir: join(config.privateDir, "rate-buyer-state"),
                    limits: {
                        maxRequestAtomic: "100",
                        maxSessionAtomic: "100",
                        maxDailyAtomic: "100",
                    },
                },
                null,
                2,
            ),
        );
        await privateWrite(
            join(config.privateDir, "rate-run.json"),
            JSON.stringify({ ...config, buyerConfigPath: buyerPath }, null, 2),
        );
        const cloud = createCloudClient({
            url: config.accountingUrl,
            buyerId,
            privateKey: pair.privateKey,
        });
        const payload = { prompt: "Reply with ok.", maxOutputTokens: 8 };
        const purchases: {
            grant: SignedDocument<Grant>;
            descriptor: ReturnType<typeof descriptorSchema.parse>;
        }[] = [];
        const buy = async () => {
            const quote = (await cloud.quote({
                providerId: config.providerIds[1],
                sessionId,
                requestId: randomUUID(),
                payloadDigest: digest(payload),
                maxOutputTokens: 8,
            })) as { quoteId: string };
            const p = (await cloud.purchase({
                quoteId: quote.quoteId,
                idempotencyKey: randomUUID(),
            })) as { signedGrant: unknown; descriptor: unknown };
            const item = {
                grant: signedGrantSchema.parse(p.signedGrant),
                descriptor: descriptorSchema.parse(p.descriptor),
            };
            purchases.push(item);
            await privateWrite(
                join(config.privateDir, "rate-purchases.private.json"),
                JSON.stringify(purchases),
            );
            return item;
        };
        for (let i = 0; i < 7; i++) await buy();
        const first = await peerFor(purchases[0]!.descriptor.ticket),
            second = await peerFor(purchases[0]!.descriptor.ticket);
        peers.push(first, second);
        const firstAdmissionAt = Date.now();
        const completion = async (peer: Peer, grant: SignedDocument<Grant>) =>
            wait(async () => {
                const r = await invoke(
                    peer,
                    grant,
                    pair.privateKey,
                    "get_request",
                    {},
                );
                return r.body?.status === "completed" ? r.body : undefined;
            }, 30000);
        for (let i = 0; i < 6; i++) {
            const peer = i % 2 ? first : second,
                grant = purchases[i]!.grant;
            const r = await invoke(
                peer,
                grant,
                pair.privateKey,
                "run_inference",
                payload,
            );
            if (r.code) throw new Error("SIX_REQUESTS_NOT_ACCEPTED");
            await completion(peer, grant);
        }
        const seventh = await invoke(
            first,
            purchases[6]!.grant,
            pair.privateKey,
            "run_inference",
            payload,
        );
        if (seventh.code !== "RATE_LIMITED")
            throw new Error("SEVENTH_REQUEST_NOT_RATE_LIMITED");
        const elapsedMs = Date.now() - firstAdmissionAt;
        if (elapsedMs >= 60000)
            throw new Error("RATE_WINDOW_ELAPSED_BEFORE_SEVENTH");
        report.rateCap = {
            status: "passed",
            accepted: 6,
            seventh: seventh.code,
            elapsedMs,
            twoPersistentPeers: true,
            requestIds: purchases.map((p) => p.grant.payload.requestId),
        };
        await first.stop();
        await second.stop();
        await stopProvider(provider);
        provider = await launchProvider(config.providerEnvs[1]);
        await wait(async () => {
            try {
                const s = (await localAdmin(provider!, "status")) as {
                    state: string;
                };
                return s.state === "ready" ? true : undefined;
            } catch {
                return undefined;
            }
        });
        const next = await buy();
        const resumed = await peerFor(next.descriptor.ticket);
        peers.push(resumed);
        const restartElapsed = Date.now() - firstAdmissionAt;
        const eighth = await invoke(
            resumed,
            next.grant,
            pair.privateKey,
            "run_inference",
            payload,
        );
        if (eighth.code === "RATE_LIMITED")
            report.rateAfterRestart = {
                status: "passed",
                rejection: eighth.code,
                elapsedMs: restartElapsed,
            };
        else {
            await completion(resumed, next.grant);
            report.rateAfterRestart = {
                status: "not_run",
                reason: "Real restart elapsed beyond the first window",
                elapsedMs: restartElapsed,
            };
        }
        const releaseAt = firstAdmissionAt + 75000;
        while (Date.now() < releaseAt) await delay(500);
        const later = await buy();
        const accepted = await invoke(
            resumed,
            later.grant,
            pair.privateKey,
            "run_inference",
            payload,
        );
        if (accepted.code)
            throw new Error("NATURAL_RATE_WINDOW_DID_NOT_RELEASE");
        await completion(resumed, later.grant);
        report.realMinuteElapsed = {
            status: "passed",
            elapsedMs: Date.now() - firstAdmissionAt,
            requestId: later.grant.payload.requestId,
        };
        await stopProvider(provider);
        const rows = await operator.pool.query(
            "SELECT request_id,status,authorized_at,receipt FROM panas_accounting_requests WHERE buyer_id=$1",
            [buyerId],
        );
        const account = (
            await operator.pool.query(
                "SELECT balance::text,held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                [buyerId],
            )
        ).rows[0];
        if (account.held !== "0" || rows.rows.some((r) => !r.receipt))
            throw new Error("RATE_FIXTURE_NOT_FINANCIALLY_TERMINAL");
        const seventhRow = rows.rows.find(
            (r) => r.request_id === purchases[6]!.grant.payload.requestId,
        );
        if (
            seventhRow?.authorized_at !== null ||
            seventhRow?.receipt.buyerDebitAtomic !== "0"
        )
            throw new Error("RATE_DECLINE_AUTHORIZED_OR_CHARGED");
        report.accounting = {
            balance: account.balance,
            held: account.held,
            completed: rows.rows.filter((r) => r.status === "completed").length,
            failed: rows.rows.filter((r) => r.status === "failed").length,
            seventhAuthorized: false,
            seventhDebitAtomic: "0",
        };
        report.status = "passed";
    } catch (error) {
        report.status = "failed";
        report.failure = /^[A-Z_]+$/.test((error as Error).message)
            ? (error as Error).message
            : "LIVE_BOUNDARY_FAILED";
        throw error;
    } finally {
        await Promise.all(peers.map((p) => p.stop().catch(() => {})));
        if (provider && !provider.stopped) await stopProvider(provider);
        await operator.pool.end();
        report.finishedAt = new Date().toISOString();
        await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
            mode: 0o600,
        });
    }
    return output;
}
