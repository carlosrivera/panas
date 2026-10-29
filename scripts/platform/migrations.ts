import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

export interface MigrationFile {
    name: string;
    sha256: string;
    sql: string;
}
export interface Baseline {
    version: 1;
    sourceCommit: string;
    schemaSha256: string;
    files: Record<string, string>;
}
export async function migrationsAt(
    directory: string,
): Promise<MigrationFile[]> {
    const names = (await readdir(directory))
        .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
        .sort();
    return Promise.all(
        names.map(async (name) => {
            const sql = await readFile(resolve(directory, name), "utf8");
            return {
                name,
                sql,
                sha256: createHash("sha256").update(sql).digest("hex"),
            };
        }),
    );
}
export function assertChecksum(actual: string, expected: string, name: string) {
    if (actual !== expected)
        throw new Error(
            `Applied migration changed: ${name}; add a forward migration instead`,
        );
}
const tables = [
    "panas_provider_keys",
    "panas_registry_reports",
    "panas_registry_current",
    "panas_registry_nonces",
    "panas_accounting_buyers",
    "panas_accounting_sessions",
    "panas_accounting_daily",
    "panas_accounting_quotes",
    "panas_accounting_requests",
    "panas_accounting_descriptors",
    "panas_accounting_nonces",
    "panas_accounting_events",
    "panas_accounting_ledger",
    "panas_accounting_operator_audit",
];
export async function baselineSchemaHash(
    client: pg.PoolClient,
): Promise<string> {
    const inventory = [];
    for (const sql of [
        "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname",
        "SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",
        "SELECT c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname",
        "SELECT c.relname,i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) ORDER BY c.relname,definition",
        "SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY t.tgname",
    ])
        inventory.push((await client.query(sql, [tables])).rows);
    inventory.push(
        (
            await client.query(
                "SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=ANY($1::text[]) ORDER BY p.proname",
                [
                    [
                        "panas_accounting_balanced",
                        "panas_accounting_append_only",
                        "panas_retire_registry_key",
                    ],
                ],
            )
        ).rows,
    );
    return createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
}
export async function inventoryBaseline(client: pg.PoolClient): Promise<void> {
    const result = await client.query(
        "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])",
        [tables],
    );
    if (
        result.rows.length !== tables.length ||
        result.rows.some(
            (row: { relrowsecurity: boolean }) => !row.relrowsecurity,
        )
    )
        throw new Error(
            "Existing schema inventory/RLS does not match the approved baseline",
        );
    const columns = await client.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND ((table_name='panas_registry_current' AND column_name='retired_at') OR (table_name='panas_accounting_requests' AND column_name IN ('signed_grant','authorized_at','reconcile_after','receipt')) OR (table_name='panas_accounting_buyers' AND column_name IN ('balance','held','max_request','max_session','max_daily')))",
    );
    if (columns.rows.length !== 10)
        throw new Error(
            "Existing financial/report columns differ from baseline",
        );
    const triggers = await client.query(
        "SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])",
        [
            [
                "panas_registry_key_retirement",
                "panas_accounting_ledger_append_only",
                "panas_accounting_audit_append_only",
            ],
        ],
    );
    if (
        triggers.rows.length !== 3 ||
        triggers.rows.some(
            (r: { tgenabled: string }) => !["O", "A"].includes(r.tgenabled),
        )
    )
        throw new Error(
            "Required append-only/key-retirement triggers are missing or disabled",
        );
    const balance = await client.query(
        'SELECT panas_accounting_balanced(\'[{"account":"a","amountAtomic":"1"},{"account":"b","amountAtomic":"-1"}]\'::jsonb) AS balanced,panas_accounting_balanced(\'[{"account":"a","amountAtomic":"1"},{"account":"b","amountAtomic":"0"}]\'::jsonb) AS unbalanced',
    );
    if (
        balance.rows[0]?.balanced !== true ||
        balance.rows[0]?.unbalanced !== false
    )
        throw new Error("Ledger balance validation differs from baseline");
    const invalid = await client.query(
        "SELECT count(*)::int AS count FROM panas_accounting_ledger WHERE panas_accounting_balanced(entries) IS DISTINCT FROM true",
    );
    if (invalid.rows[0]?.count !== 0)
        throw new Error(
            "Existing ledger contains invalid groups; automatic migration adoption refused",
        );
}
export async function applyMigrations(
    pool: pg.Pool,
    files: MigrationFile[],
    release: string,
    baseline?: Baseline,
) {
    const client = await pool.connect();
    let applied = 0,
        adopted = 0;
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(729114005)");
        await client.query(
            "CREATE TABLE IF NOT EXISTS panas_schema_migrations (name text PRIMARY KEY,sha256 text NOT NULL CHECK(length(sha256)=64),release_sha text NOT NULL,adopted boolean NOT NULL DEFAULT false,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
        );
        await client.query(
            "ALTER TABLE panas_schema_migrations ENABLE ROW LEVEL SECURITY",
        );
        const tracked = (
            await client.query(
                "SELECT name,sha256 FROM panas_schema_migrations",
            )
        ).rows as { name: string; sha256: string }[];
        const existing = new Map(tracked.map((r) => [r.name, r.sha256]));
        for (const entry of tracked) {
            if (!files.some((f) => f.name === entry.name))
                throw new Error(`Applied migration removed: ${entry.name}`);
        }
        if (!baseline && tracked.length === 0) {
            const legacy = await client.query(
                "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])",
                [tables],
            );
            if (legacy.rows[0]?.count !== 0)
                throw new Error(
                    "Untracked existing application schema requires explicit approved baseline adoption",
                );
        }
        if (baseline) {
            if (
                baseline.version !== 1 ||
                !/^[a-f0-9]{40}$/.test(baseline.sourceCommit)
            )
                throw new Error("Invalid baseline metadata");
            if (tracked.length !== 0)
                throw new Error(
                    "Baseline adoption is allowed only for an empty migration tracker",
                );
            await inventoryBaseline(client);
            if ((await baselineSchemaHash(client)) !== baseline.schemaSha256)
                throw new Error(
                    "Existing schema constraints/functions differ from the fingerprint of the clean baseline",
                );
            for (const [name, sha] of Object.entries(baseline.files)) {
                const file = files.find((f) => f.name === name);
                if (!file)
                    throw new Error(`Approved baseline file missing: ${name}`);
                assertChecksum(file.sha256, sha, name);
                await client.query(
                    "INSERT INTO panas_schema_migrations(name,sha256,release_sha,adopted) VALUES($1,$2,$3,true)",
                    [name, sha, baseline.sourceCommit],
                );
                existing.set(name, sha);
                adopted++;
            }
            await client.query(
                "INSERT INTO panas_accounting_operator_audit(audit_id,action,reference_id,reason,metadata,created_at) VALUES(gen_random_uuid(),'adopt_schema_baseline',gen_random_uuid(),'Explicit adoption of previously deployed and inventoried migrations without financial mutation',$1,clock_timestamp())",
                [
                    {
                        sourceCommit: baseline.sourceCommit,
                        release,
                        files: adopted,
                    },
                ],
            );
        }
        for (const file of files) {
            const old = existing.get(file.name);
            if (old) {
                assertChecksum(file.sha256, old, file.name);
                continue;
            }
            await client.query(file.sql);
            await client.query(
                "INSERT INTO panas_schema_migrations(name,sha256,release_sha,adopted) VALUES($1,$2,$3,false)",
                [file.name, file.sha256, release],
            );
            applied++;
        }
        await client.query("COMMIT");
        return {
            mode: "tracked" as const,
            applied,
            adopted,
            total: existing.size + applied,
        };
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch {
            /* Keep original failure. */
        }
        throw error;
    } finally {
        client.release();
    }
}
