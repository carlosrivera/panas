import { assertIsolatedBranch } from "./isolation.js";
import { PLATFORM } from "./config.js";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    applyMigrations,
    baselineSchemaHash,
    migrationsAt,
} from "./migrations.js";
import {
    root,
    revision,
    management,
    assertProjectBinding,
    token,
} from "./runtime.js";

// Deliberate operator-only destructive fixture preparation. Never included in deployment.
const branch = process.env.PANAS_MIGRATION_DATABASE_URL;
if (process.argv[2] !== "--reset-isolated-branch" || !branch)
    throw new Error(
        "Explicit isolated branch reset flag and branch URL required",
    );
await assertProjectBinding();
token();
const source = await management<Parameters<typeof assertIsolatedBranch>[1]>(
    `/projects/${PLATFORM.projectId}/databases/registry`,
);
const identity = await management<Parameters<typeof assertIsolatedBranch>[2]>(
    `/projects/${PLATFORM.projectId}/databases/registry/branches/platform_empty_check`,
);
assertIsolatedBranch(branch, source, identity);
const pool = new pg.Pool({ connectionString: branch, max: 1 });
pool.on("error", () => {});
try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const files = await migrationsAt(resolve(root, "volcano/migrations"));
    const baseline = JSON.parse(
        await readFile(
            resolve(root, "volcano/migration-baseline.json"),
            "utf8",
        ),
    ) as { schemaSha256?: string; files: Record<string, string> };
    console.log(
        JSON.stringify({
            emptyDatabase: await applyMigrations(pool, files, revision()),
        }),
    );
    const client = await pool.connect();
    try {
        const actual = await baselineSchemaHash(client);
        if (actual !== baseline.schemaSha256)
            throw new Error(
                "Clean baseline schema fingerprint differs from committed approval",
            );
    } finally {
        client.release();
    }
    console.log(
        JSON.stringify({
            secondRun: await applyMigrations(pool, files, revision()),
            schemaFingerprint: baseline.schemaSha256,
        }),
    );
    const changed = files.map((file, index) =>
        index === 0 ? { ...file, sha256: "0".repeat(64) } : file,
    );
    let rejected = false;
    try {
        await applyMigrations(pool, changed, revision());
    } catch {
        rejected = true;
    }
    if (!rejected) throw new Error("Checksum drift was accepted");
    console.log(
        "Empty branch migration and repeat/checksum-drift boundaries passed.",
    );
} finally {
    await pool.end();
}
