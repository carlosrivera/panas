import { execFileSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { keyId } from "@panas/protocol";
import { localConfigSchema, readPrivate } from "./config.js";
import { openOperator } from "./prepare.js";
import { repositoryRoot, portClosed } from "./processes.js";
import { readOwnerConfig } from "../../../apps/buyer-mcp/src/config.js";
import { operationalSummary } from "../../../scripts/platform/operations.js";

const inputSchema = z
    .object({
        runConfigPaths: z.array(z.string()).min(1).max(5),
        outputDirectory: z.string(),
        reason: z.string().min(30).max(800),
    })
    .strict();
/** Explicit operator action, never called by paid dispatch or automatically on a failed test. */
export async function reconcileFixtures(path: string): Promise<string> {
    const input = inputSchema.parse(JSON.parse(await readPrivate(path)));
    if (
        !(await Promise.all([11601, 11602, 11612].map(portClosed))).every(
            Boolean,
        )
    )
        throw new Error("OWNED_RUNTIMES_MUST_BE_STOPPED_FOR_REVIEW");
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
    }).trim();
    const sourceTreeDirty =
        execFileSync("git", ["status", "--porcelain"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim().length > 0;
    const results: unknown[] = [];
    for (const configPath of input.runConfigPaths) {
        const run = localConfigSchema.parse(
                JSON.parse(await readPrivate(configPath)),
            ),
            owner = readOwnerConfig(run.buyerConfigPath),
            operator = await openOperator(run.operatorEnvPath);
        try {
            if (
                keyId(await readPrivate(owner.platformPublicKeyPath)) !==
                keyId(operator.privateKey)
            )
                throw new Error("OPERATOR_PLATFORM_PIN_MISMATCH");
            const keyRow = await operator.pool.query(
                "SELECT public_key_pem,policy_version FROM panas_accounting_buyers WHERE buyer_id=$1",
                [owner.buyerId],
            );
            if (
                keyRow.rowCount !== 1 ||
                keyRow.rows[0].policy_version !==
                    "integration-test-credits-only" ||
                keyId(keyRow.rows[0].public_key_pem) !==
                    keyId(
                        createPrivateKey(
                            await readPrivate(owner.privateKeyPath),
                        ),
                    )
            )
                throw new Error("FIXTURE_BUYER_KEY_MISMATCH");
            const snapshot = async () => {
                const row = await operator.pool.query(
                    "SELECT balance::text,held::text,(SELECT count(*)::int FROM panas_accounting_ledger l WHERE l.request_id IN (SELECT request_id FROM panas_accounting_requests WHERE buyer_id=$1) AND l.kind='settle') AS settlements FROM panas_accounting_buyers WHERE buyer_id=$1",
                    [owner.buyerId],
                );
                return z
                    .object({
                        balance: z.string(),
                        held: z.string(),
                        settlements: z.number().int(),
                    })
                    .parse(row.rows[0]);
            };
            const before = await snapshot();
            const pending = await operator.pool.query(
                "SELECT request_id,status,authorized_at,reconcile_after,signed_grant->'payload'->>'executeBefore' AS execute_before FROM panas_accounting_requests WHERE buyer_id=$1 AND status IN ('reserved','authorized','pending') ORDER BY reconcile_after",
                [owner.buyerId],
            );
            const released: unknown[] = [];
            for (const row of pending.rows) {
                if (
                    row.authorized_at !== null ||
                    row.status === "authorized" ||
                    Date.parse(row.execute_before) > Date.now()
                )
                    throw new Error(
                        "UNCERTAIN_AUTHORIZED_WORK_REQUIRES_SEPARATE_REVIEW",
                    );
                const due = new Date(row.reconcile_after).getTime();
                if (due - Date.now() > 600000)
                    throw new Error("RECONCILIATION_WAIT_OUT_OF_BOUND");
                while (Date.now() < due + 500)
                    await delay(Math.min(5000, due + 500 - Date.now()));
                if (
                    !(
                        await Promise.all([11601, 11602, 11612].map(portClosed))
                    ).every(Boolean)
                )
                    throw new Error(
                        "OWNED_RUNTIME_STARTED_DURING_OPERATOR_WAIT",
                    );
                // Only the existing audited transaction writes financial state; no backdated clock or SQL mutation.
                const resolution = await operator.service.operatorResolve({
                    requestId: row.request_id,
                    action: "release",
                    reason: input.reason,
                });
                const receipt = z
                    .object({
                        receiptId: z.uuid(),
                        buyerDebitAtomic: z.literal("0"),
                        providerEarningsAtomic: z.literal("0"),
                        feeAtomic: z.literal("0"),
                    })
                    .parse(resolution.receipt);
                const audit = await operator.pool.query(
                    "SELECT audit_id FROM panas_accounting_operator_audit WHERE reference_id=$1 AND action='release'",
                    [row.request_id],
                );
                if (audit.rowCount !== 1)
                    throw new Error("OPERATOR_AUDIT_REQUIRED");
                released.push({
                    requestId: row.request_id,
                    receiptId: receipt.receiptId,
                    auditId: audit.rows[0].audit_id,
                    action: "release",
                    reconcileAfter: new Date(due).toISOString(),
                    observedAfterRealDeadline: true,
                });
            }
            const after = await snapshot();
            if (
                after.held !== "0" ||
                before.balance !== after.balance ||
                before.settlements !== after.settlements
            )
                throw new Error(
                    "OPERATOR_RELEASE_CHANGED_BALANCE_OR_SETTLEMENT",
                );
            const client = await operator.pool.connect();
            let invariants;
            try {
                invariants = await operationalSummary(
                    client,
                    "integration-operator-review",
                );
            } finally {
                client.release();
            }
            if (
                invariants.ledgerImbalanceCount !== 0 ||
                invariants.heldMismatchCount !== 0
            )
                throw new Error("LEDGER_OR_HOLD_INVARIANT_FAILED");
            results.push({
                buyerId: owner.buyerId,
                before,
                after,
                released,
                ledgerImbalanceCount: invariants.ledgerImbalanceCount,
                heldMismatchCount: invariants.heldMismatchCount,
            });
        } finally {
            await operator.pool.end();
        }
    }
    const output = join(
        input.outputDirectory,
        `operator-review-${Date.now()}.json`,
    );
    await writeFile(
        output,
        JSON.stringify(
            {
                schemaVersion: 1,
                scope: "explicit-audited-test-fixture-operator-review",
                gitCommit,
                sourceTreeDirty,
                observedAt: new Date().toISOString(),
                reason: input.reason,
                results,
            },
            null,
            2,
        ) + "\n",
        { mode: 0o600 },
    );
    return output;
}
