import pg from "pg";

declare const PANAS_RELEASE_SHA: string;
export interface OperationalSummary {
    ok: boolean;
    releaseSha: string;
    observedAt: string;
    overduePendingCount: number;
    ledgerImbalanceCount: number;
    heldMismatchCount: number;
    requiresOperatorReview: boolean;
}
export async function operationalSummary(
    client: pg.PoolClient,
    releaseSha: string,
): Promise<OperationalSummary> {
    const counts = await client.query(
        "SELECT (SELECT count(*)::int FROM panas_accounting_requests WHERE status IN ('reserved','authorized','pending') AND reconcile_after<=clock_timestamp()) AS overdue,(SELECT count(*)::int FROM panas_accounting_ledger WHERE panas_accounting_balanced(entries) IS DISTINCT FROM true) AS imbalance,(SELECT count(*)::int FROM panas_accounting_buyers b WHERE b.held<>COALESCE((SELECT sum((r.signed_grant->'payload'->>'totalAtomic')::numeric) FROM panas_accounting_requests r WHERE r.buyer_id=b.buyer_id AND r.status IN ('reserved','authorized','pending')),0)) AS mismatch",
    );
    const row = counts.rows[0] as {
        overdue: number;
        imbalance: number;
        mismatch: number;
    };
    return {
        ok: row.imbalance === 0 && row.mismatch === 0,
        releaseSha,
        observedAt: new Date().toISOString(),
        overduePendingCount: row.overdue,
        ledgerImbalanceCount: row.imbalance,
        heldMismatchCount: row.mismatch,
        requiresOperatorReview: row.overdue > 0,
    };
}
export async function reconcileMetadata(pool: pg.Pool, releaseSha: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            "WITH due AS (SELECT request_id FROM panas_accounting_requests WHERE status IN ('reserved','authorized') AND reconcile_after<=clock_timestamp() ORDER BY reconcile_after FOR UPDATE SKIP LOCKED LIMIT 100) UPDATE panas_accounting_requests r SET status='pending' FROM due WHERE r.request_id=due.request_id RETURNING r.request_id",
        );
        const summary = await operationalSummary(client, releaseSha);
        await client.query(
            "INSERT INTO panas_platform_operations(job,observed_at,summary) VALUES('reconciliation',clock_timestamp(),$1) ON CONFLICT(job) DO UPDATE SET observed_at=EXCLUDED.observed_at,summary=EXCLUDED.summary",
            [{ ...summary, markedPending: result.rowCount ?? 0 }],
        );
        await client.query("COMMIT");
        return { ...summary, markedPending: result.rowCount ?? 0 };
    } catch {
        try {
            await client.query("ROLLBACK");
        } catch {
            /* Fail closed. */
        }
        throw new Error(
            "Operational reconciliation failed; funds remain unchanged",
        );
    } finally {
        client.release();
    }
}
let pool: pg.Pool | undefined;
export async function handler(event: unknown) {
    const connectionString = process.env.PANAS_REGISTRY_DATABASE_URL;
    if (!connectionString) return { ok: false, code: "UNAVAILABLE" };
    if (!pool) {
        pool = new pg.Pool({
            connectionString,
            max: 1,
            connectionTimeoutMillis: 5000,
            query_timeout: 15000,
            idleTimeoutMillis: 15000,
        });
        pool.on("error", () =>
            console.warn("Panas operations idle database connection failed"),
        );
    }
    const job =
        typeof event === "object" && event !== null && "job" in event
            ? event.job
            : "health";
    try {
        if (job === "reconcile")
            return await reconcileMetadata(pool, PANAS_RELEASE_SHA);
        if (job !== "health") return { ok: false, code: "INVALID_JOB" };
        const client = await pool.connect();
        try {
            return await operationalSummary(client, PANAS_RELEASE_SHA);
        } finally {
            client.release();
        }
    } catch {
        return { ok: false, code: "UNAVAILABLE" };
    }
}
