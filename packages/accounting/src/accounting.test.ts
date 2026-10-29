import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import pg from "pg";
import { prototypeLimits } from "@panas/contracts";
import { requiredCapabilityChecks } from "@panas/contracts/provider";
import {
    DOMAIN,
    digest,
    keyId,
    signDocument,
    type Quote,
    type Grant,
    type SignedDocument,
    type TerminalEvent,
} from "@panas/protocol";
import { AccountingService } from "./service";
import { createHttpHandler } from "./http";

const databaseUrl = process.env.PANAS_ACCOUNTING_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
    "real Postgres fixed-price authorization and ledger",
    { timeout: 90000 },
    () => {
        const pool = new pg.Pool({
            connectionString: databaseUrl,
            max: 8,
            connectionTimeoutMillis: 10000,
            query_timeout: 30000,
        });
        const platform = generateKeyPairSync("ed25519"),
            provider = generateKeyPairSync("ed25519"),
            buyer = generateKeyPairSync("ed25519");
        const providerId = randomUUID(),
            providerPem = provider.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            buyerPem = buyer.publicKey
                .export({ type: "spki", format: "pem" })
                .toString();
        let now = new Date(),
            buyerId: string,
            sessionId: string,
            startupId: string;
        const service = new AccountingService(pool, {
            platformPrivateKey: platform.privateKey,
            descriptorEncryptionKey: randomBytes(32),
            feeAtomic: "2",
            clock: () => now,
        });
        async function actor(
            role: "buyer" | "provider",
            path: string,
            body: unknown,
            method: "GET" | "POST" = "POST",
        ) {
            const proof = signDocument(
                DOMAIN.cloud,
                {
                    version: 1 as const,
                    actor: role,
                    actorId: role === "buyer" ? buyerId : providerId,
                    method,
                    path,
                    bodyDigest: digest(body),
                    nonce: randomUUID(),
                    issuedAt: now.toISOString(),
                    expiresAt: new Date(now.getTime() + 120000).toISOString(),
                },
                role === "buyer" ? buyer.privateKey : provider.privateKey,
            );
            return service.authenticate(proof, method, path, body);
        }
        async function quote() {
            const body = {
                providerId,
                sessionId,
                requestId: randomUUID(),
                payloadDigest: digest({
                    prompt: "fixture",
                    maxOutputTokens: 16,
                }),
                maxOutputTokens: 16,
            };
            return service.quote(await actor("buyer", "/quotes", body), body);
        }
        async function purchase(q: Quote, idem = randomUUID()) {
            const body = { quoteId: q.quoteId, idempotencyKey: idem };
            return service.purchase(
                await actor("buyer", "/purchases", body),
                body,
            );
        }
        async function authorize(grant: Grant) {
            const path = `/provider/requests/${grant.requestId}/authorize`,
                body = {
                    reservationId: grant.reservationId,
                    grantId: grant.grantId,
                    operation: "run_inference" as const,
                    payloadDigest: grant.payloadDigest,
                };
            return service.authorize(
                await actor("provider", path, body),
                grant.requestId,
                body,
            );
        }
        function event(grant: Grant, outcome: TerminalEvent["outcome"]) {
            return signDocument(
                DOMAIN.terminal,
                {
                    version: 1 as const,
                    eventId: randomUUID(),
                    grantId: grant.grantId,
                    reservationId: grant.reservationId,
                    requestId: grant.requestId,
                    providerId,
                    startupId: grant.startupId,
                    outcome,
                    resultDigest:
                        outcome === "completed" ? "c".repeat(64) : null,
                    completedAt: now.toISOString(),
                    usage: { inputTokens: 5, outputTokens: 16, durationMs: 10 },
                },
                provider.privateKey,
            );
        }
        async function terminal(signed: SignedDocument<TerminalEvent>) {
            const path = `/provider/requests/${signed.payload.requestId}/terminal`,
                body = { event: signed };
            return service.terminal(
                await actor("provider", path, body),
                signed.payload.requestId,
                body,
            );
        }
        async function status(id: string) {
            const path = `/requests/${id}`;
            return service.getRequest(
                await actor("buyer", path, null, "GET"),
                id,
            ) as Promise<{
                status: string;
                receipt: { buyerDebitAtomic: string } | null;
                signedGrant: SignedDocument<Grant>;
            }>;
        }
        beforeAll(async () => {
            await pool.query("SELECT 1");
            await pool.query(
                "INSERT INTO panas_provider_keys(provider_id,public_key_pem) VALUES($1,$2)",
                [providerId, providerPem],
            );
        });
        beforeEach(async () => {
            now = new Date();
            buyerId = randomUUID();
            sessionId = randomUUID();
            startupId = randomUUID();
            const report = {
                schemaVersion: 1,
                providerId,
                startupId,
                sequence: 0,
                testedAt: now.toISOString(),
                platform: "darwin",
                architecture: "arm64",
                memoryBytes: 16 * 1024 ** 3,
                freeDiskBytes: 10 * 1024 ** 3,
                model: {
                    name: "qwen2.5:0.5b",
                    digest: "a".repeat(64),
                    runtimeVersion: "0.23.4",
                },
                profile: prototypeLimits,
                checks: requiredCapabilityChecks.map((name) => ({
                    name,
                    passed: true,
                    detail: "isolated accounting database fixture, not hardware evidence",
                })),
                peerProbe: { status: "verified", testedAt: now.toISOString() },
                benchmark: { warmLatencyMs: 10, tokensPerSecond: 20 },
                state: "ready",
            };
            await pool.query(
                "INSERT INTO panas_registry_current(provider_id,startup_id,sequence,report_digest,report,price,state,eligible,received_at,created_at,retired_at) VALUES($1,$2,0,$3,$4,$5,'ready',true,$6,$6,NULL) ON CONFLICT(provider_id) DO UPDATE SET startup_id=EXCLUDED.startup_id,report=EXCLUDED.report,price=EXCLUDED.price,state='ready',eligible=true,received_at=EXCLUDED.received_at,retired_at=NULL",
                [
                    providerId,
                    startupId,
                    digest(report),
                    report,
                    {
                        version: "fixture-v1",
                        totalAtomic: "8",
                        currency: "TEST_CREDIT",
                    },
                    now,
                ],
            );
            await service.operatorEnrollBuyer({
                buyerId,
                publicKeyPem: buyerPem,
                maxRequestAtomic: "20",
                maxSessionAtomic: "30",
                maxDailyAtomic: "30",
                policyVersion: "fixture-policy",
            });
            await service.operatorOpenSession({
                buyerId,
                sessionId,
                capAtomic: "30",
                expiresAt: new Date(now.getTime() + 3600000).toISOString(),
            });
            await service.operatorFund({
                buyerId,
                amountAtomic: "30",
                idempotencyKey: randomUUID(),
            });
            const path = "/provider/descriptor",
                body = {
                    startupId,
                    ticket: `wire://${"d".repeat(64)}`,
                    providerKeyId: keyId(providerPem),
                    providerPublicKeyPem: providerPem,
                    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
                };
            await service.uploadDescriptor(
                await actor("provider", path, body),
                body,
            );
        });
        afterAll(async () => {
            await pool.end();
        }); // Append-only fixture ledger intentionally remains in the disposable test branch.
        it("serializes competing reservations across balance, session, and daily limits", async () => {
            const quotes = await Promise.all([
                quote(),
                quote(),
                quote(),
                quote(),
            ]);
            const result = await Promise.allSettled(
                quotes.map((q) => purchase(q)),
            );
            expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(
                3,
            );
            expect(result.filter((r) => r.status === "rejected")).toHaveLength(
                1,
            );
            const row = (
                await pool.query(
                    "SELECT balance::text,held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                    [buyerId],
                )
            ).rows[0];
            expect(row).toMatchObject({ balance: "30", held: "30" });
        });
        it("enforces request, session, daily and available-credit caps independently", async () => {
            const cases = [
                {
                    request: "9",
                    session: "100",
                    daily: "100",
                    providerPrice: "8",
                },
                {
                    request: "100",
                    session: "9",
                    daily: "100",
                    providerPrice: "8",
                },
                {
                    request: "100",
                    session: "100",
                    daily: "9",
                    providerPrice: "8",
                },
                {
                    request: "100",
                    session: "100",
                    daily: "100",
                    providerPrice: "38",
                },
            ];
            for (const c of cases) {
                await pool.query(
                    "UPDATE panas_accounting_buyers SET max_request=$2,max_session=$3,max_daily=$4 WHERE buyer_id=$1",
                    [buyerId, c.request, c.session, c.daily],
                );
                await pool.query(
                    "UPDATE panas_accounting_sessions SET cap=100 WHERE session_id=$1",
                    [sessionId],
                );
                await pool.query(
                    "UPDATE panas_registry_current SET price=jsonb_set(price,'{totalAtomic}',to_jsonb($2::text)) WHERE provider_id=$1",
                    [providerId, c.providerPrice],
                );
                await expect(purchase(await quote())).rejects.toMatchObject({
                    code: "SPENDING_LIMIT",
                });
                expect(
                    (
                        await pool.query(
                            "SELECT held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                            [buyerId],
                        )
                    ).rows[0].held,
                ).toBe("0");
            }
        });
        it("returns the same execution grant for purchase retries and rejects changed idempotency binding", async () => {
            const q = await quote(),
                idem = randomUUID(),
                first = await purchase(q, idem);
            now = new Date(now.getTime() + 1000);
            const retry = await purchase(q, idem);
            expect(retry.signedGrant).toEqual(first.signedGrant);
            const second = await quote();
            await expect(purchase(second, idem)).rejects.toMatchObject({
                code: "CONFLICT",
            });
            const view = await status(q.requestId);
            expect(view.signedGrant.payload.operations).toEqual([
                "get_request",
                "cancel_request",
            ]);
            expect(view.signedGrant.payload.executeBefore).toBe(
                first.signedGrant.payload.executeBefore,
            );
        });
        it("settles exactly once from provider-confirmed completion and posts a balanced immutable ledger", async () => {
            const bought = await purchase(await quote());
            await authorize(bought.signedGrant.payload);
            const signed = event(bought.signedGrant.payload, "completed");
            await pool.query(
                "UPDATE panas_accounting_buyers SET enabled=false WHERE buyer_id=$1",
                [buyerId],
            );
            const first = await terminal(signed),
                again = await terminal(signed);
            await pool.query(
                "UPDATE panas_accounting_buyers SET enabled=true WHERE buyer_id=$1",
                [buyerId],
            );
            expect(first).toMatchObject({
                receipt: {
                    buyerDebitAtomic: "10",
                    providerEarningsAtomic: "8",
                    feeAtomic: "2",
                },
            });
            expect(again).toEqual(first);
            const view = await status(bought.quote.requestId);
            expect(view.status).toBe("completed");
            expect(view.receipt?.buyerDebitAtomic).toBe("10");
            const ledger = (
                await pool.query(
                    "SELECT ledger_id,entries FROM panas_accounting_ledger WHERE request_id=$1 AND kind='settle'",
                    [bought.quote.requestId],
                )
            ).rows;
            expect(ledger).toHaveLength(1);
            expect(
                (ledger[0].entries as { amountAtomic: string }[]).reduce(
                    (s, e) => s + BigInt(e.amountAtomic),
                    0n,
                ),
            ).toBe(0n);
            await expect(
                pool.query(
                    "DELETE FROM panas_accounting_ledger WHERE ledger_id=$1",
                    [ledger[0].ledger_id],
                ),
            ).rejects.toThrow("append-only");
            for (const entries of [
                [
                    { account: "x", amountAtomic: "1" },
                    { account: "y", amountAtomic: "0" },
                ],
                [
                    { account: "x", amountAtomic: "1" },
                    { account: "y", amountAtomic: "-1" },
                    { account: "z" },
                ],
            ])
                await expect(
                    pool.query(
                        "INSERT INTO panas_accounting_ledger(ledger_id,idempotency_key,kind,entries,created_at) VALUES($1,$2,'fund',$3,$4)",
                        [
                            randomUUID(),
                            `invalid:${randomUUID()}`,
                            JSON.stringify(entries),
                            now,
                        ],
                    ),
                ).rejects.toMatchObject({ code: "23514" });
        });
        it("requires admitted execution for success, and buyer cancellation cannot release uncertain spend", async () => {
            const bought = await purchase(await quote());
            await expect(
                terminal(event(bought.signedGrant.payload, "completed")),
            ).rejects.toMatchObject({ code: "CONFLICT" });
            await authorize(bought.signedGrant.payload);
            const path = `/requests/${bought.quote.requestId}/cancel`;
            await service.cancel(
                await actor("buyer", path, {}),
                bought.quote.requestId,
            );
            expect(
                (
                    await pool.query(
                        "SELECT held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                        [buyerId],
                    )
                ).rows[0].held,
            ).toBe("10");
            await terminal(event(bought.signedGrant.payload, "unknown"));
            expect((await status(bought.quote.requestId)).status).toBe(
                "pending",
            );
            now = new Date(now.getTime() + 600001);
            await service.operatorResolve({
                requestId: bought.quote.requestId,
                action: "release",
                reason: "Operator verified failure after explicit reconciliation deadline",
            });
            expect(
                (
                    await pool.query(
                        "SELECT held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                        [buyerId],
                    )
                ).rows[0].held,
            ).toBe("0");
        });
        it("uses one durable terminal CAS for completion versus cancellation", async () => {
            const bought = await purchase(await quote());
            await authorize(bought.signedGrant.payload);
            const results = await Promise.allSettled([
                terminal(event(bought.signedGrant.payload, "completed")),
                terminal(event(bought.signedGrant.payload, "cancelled")),
            ]);
            expect(
                results.filter((r) => r.status === "fulfilled"),
            ).toHaveLength(1);
            expect(results.filter((r) => r.status === "rejected")).toHaveLength(
                1,
            );
            const row = (
                await pool.query(
                    "SELECT balance::text,held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                    [buyerId],
                )
            ).rows[0];
            expect(row.held).toBe("0");
            expect(["20", "30"]).toContain(row.balance);
        });
        it("refunds with compensating entries without restoring gross owner spending allowance", async () => {
            const bought = await purchase(await quote());
            await authorize(bought.signedGrant.payload);
            await terminal(event(bought.signedGrant.payload, "completed"));
            await service.operatorResolve({
                requestId: bought.quote.requestId,
                action: "refund",
                reason: "Operator confirmed the durable result could not be retrieved",
            });
            await service.operatorResolve({
                requestId: bought.quote.requestId,
                action: "refund",
                reason: "Idempotent operator refund retry after lost response",
            });
            const row = (
                await pool.query(
                    "SELECT balance::text,held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
                    [buyerId],
                )
            ).rows[0];
            expect(row.balance).toBe("30");
            expect(row.held).toBe("0");
            expect(
                (
                    await pool.query(
                        "SELECT count(*)::int AS count FROM panas_accounting_ledger WHERE request_id=$1 AND kind='refund'",
                        [bought.quote.requestId],
                    )
                ).rows[0].count,
            ).toBe(1);
            expect(
                (
                    await pool.query(
                        "SELECT spent::text FROM panas_accounting_sessions WHERE session_id=$1",
                        [sessionId],
                    )
                ).rows[0].spent,
            ).toBe("10");
        });
        it("rechecks proof expiry after database locks and rejects owner revocation before admission", async () => {
            const input = {
                providerId,
                sessionId,
                requestId: randomUUID(),
                payloadDigest: "a".repeat(64),
                maxOutputTokens: 16,
            };
            const accepted = await actor("buyer", "/quotes", input);
            now = new Date(now.getTime() + 120001);
            await expect(service.quote(accepted, input)).rejects.toMatchObject({
                code: "UNAUTHORIZED",
            });
            now = new Date();
            const bought = await purchase(await quote());
            await pool.query(
                "UPDATE panas_accounting_buyers SET enabled=false WHERE buyer_id=$1",
                [buyerId],
            );
            await expect(
                authorize(bought.signedGrant.payload),
            ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        });
        it("rejects stale provider/profile changes and never exposes owner funding or policy routes", async () => {
            const q = await quote();
            await pool.query(
                "UPDATE panas_registry_current SET report=jsonb_set(report,'{profile,timeoutMs}','1000') WHERE provider_id=$1",
                [providerId],
            );
            await expect(purchase(q)).rejects.toMatchObject({
                code: "PROVIDER_UNAVAILABLE",
            });
            const handler = createHttpHandler(service),
                path = "/owner/fund",
                body = { amountAtomic: "999999" };
            const proof = signDocument(
                DOMAIN.cloud,
                {
                    version: 1 as const,
                    actor: "buyer" as const,
                    actorId: buyerId,
                    method: "POST" as const,
                    path,
                    bodyDigest: digest(body),
                    nonce: randomUUID(),
                    issuedAt: now.toISOString(),
                    expiresAt: new Date(now.getTime() + 120000).toISOString(),
                },
                buyer.privateKey,
            );
            expect(
                (
                    await handler(
                        new Request(`https://accounting.test${path}`, {
                            method: "POST",
                            headers: {
                                "x-panas-proof": Buffer.from(
                                    JSON.stringify(proof),
                                ).toString("base64url"),
                            },
                            body: JSON.stringify(body),
                        }),
                    )
                ).status,
            ).toBe(404);
        });
    },
);
