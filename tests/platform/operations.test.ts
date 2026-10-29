import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
    reconcileMetadata,
    operationalSummary,
} from "../../scripts/platform/operations.js";
const url = process.env.PANAS_PLATFORM_TEST_DATABASE_URL;
describe.skipIf(!url)(
    "real Postgres metadata reconciliation",
    { timeout: 90000 },
    () => {
        const pool = new pg.Pool({
            connectionString: url,
            max: 6,
            connectionTimeoutMillis: 10000,
        });
        pool.on("error", () => {});
        afterAll(async () => {
            await pool.end();
        });
        it("competing workers mark overdue uncertain requests pending and preserve every financial row", async () => {
            const buyer = randomUUID(),
                session = randomUUID();
            const requests = [randomUUID(), randomUUID(), randomUUID()];
            const ledger = randomUUID();
            await pool.query(
                "INSERT INTO panas_accounting_buyers(buyer_id,public_key_pem,balance,held,max_request,max_session,max_daily,policy_version) VALUES($1,'ISOLATED_PLATFORM_FIXTURE',30,30,10,30,30,'fixture')",
                [buyer],
            );
            await pool.query(
                "INSERT INTO panas_accounting_sessions(session_id,buyer_id,cap,held,expires_at) VALUES($1,$2,30,30,clock_timestamp()+interval '1 hour')",
                [session, buyer],
            );
            await pool.query(
                "INSERT INTO panas_accounting_daily(buyer_id,usage_day,held) VALUES($1,current_date,30)",
                [buyer],
            );
            await pool.query(
                "INSERT INTO panas_accounting_ledger(ledger_id,idempotency_key,kind,entries,created_at) VALUES($1,$2,'fund',$3,clock_timestamp())",
                [
                    ledger,
                    `fixture:${ledger}`,
                    JSON.stringify([
                        { account: "issuer:test-credit", amountAtomic: "-30" },
                        { account: `buyer:${buyer}`, amountAtomic: "30" },
                    ]),
                ],
            );
            for (let i = 0; i < requests.length; i++) {
                const quote = randomUUID();
                await pool.query(
                    "INSERT INTO panas_accounting_quotes(quote_id,buyer_id,request_id,fingerprint,quote,created_at) VALUES($1,$2,$3,'fixture','{}',clock_timestamp())",
                    [quote, buyer, requests[i]],
                );
                await pool.query(
                    "INSERT INTO panas_accounting_requests(request_id,reservation_id,buyer_id,session_id,quote_id,idempotency_key,signed_grant,status,usage_day,policy_version,reconcile_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,current_date,'fixture',clock_timestamp()+$9::interval,clock_timestamp())",
                    [
                        requests[i],
                        randomUUID(),
                        buyer,
                        session,
                        quote,
                        randomUUID(),
                        { payload: { totalAtomic: "10" } },
                        i === 1 ? "authorized" : "reserved",
                        i === 2 ? "1 hour" : "-1 minute",
                    ],
                );
            }
            async function finance() {
                return (
                    await pool.query(
                        "SELECT (SELECT row_to_json(b) FROM panas_accounting_buyers b WHERE buyer_id=$1) AS buyer,(SELECT row_to_json(s) FROM panas_accounting_sessions s WHERE session_id=$2) AS session,(SELECT row_to_json(d) FROM panas_accounting_daily d WHERE buyer_id=$1) AS daily,(SELECT row_to_json(l) FROM panas_accounting_ledger l WHERE ledger_id=$3) AS ledger",
                        [buyer, session, ledger],
                    )
                ).rows[0];
            }
            const before = await finance();
            await Promise.all(
                Array.from({ length: 5 }, () =>
                    reconcileMetadata(pool, "fixture-release"),
                ),
            );
            expect(await finance()).toEqual(before);
            const state = (
                await pool.query(
                    "SELECT request_id,status,receipt FROM panas_accounting_requests WHERE request_id=ANY($1::uuid[])",
                    [requests],
                )
            ).rows;
            expect(state.filter((r) => r.status === "pending")).toHaveLength(2);
            expect(
                state.find((r) => r.request_id === requests[2])?.status,
            ).toBe("reserved");
            expect(state.every((r) => r.receipt === null)).toBe(true);
            expect(
                (await reconcileMetadata(pool, "fixture-release"))
                    .markedPending,
            ).toBe(0);
            const client = await pool.connect();
            try {
                const health = await operationalSummary(
                    client,
                    "fixture-release",
                );
                expect(health.ledgerImbalanceCount).toBe(0);
                expect(health.heldMismatchCount).toBe(0);
                expect(health.requiresOperatorReview).toBe(true);
            } finally {
                client.release();
            }
        });
    },
);
