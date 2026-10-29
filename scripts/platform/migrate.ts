import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { applyMigrations, migrationsAt, type Baseline } from "./migrations.js";
import { assertProjectBinding, root, revision, variable } from "./runtime.js";

await assertProjectBinding();
const explicit = process.env.PANAS_MIGRATION_DATABASE_URL;
if (explicit && !process.argv.includes("--isolated-test"))
    throw new Error(
        "Explicit database URLs are allowed only with --isolated-test; normal deploy reads the dedicated project variable",
    );
const url = explicit ?? (await variable("PANAS_REGISTRY_DATABASE_URL"));
const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 120000,
});
pool.on("error", () =>
    console.warn(
        "Migration connection failed; no connection diagnostics displayed",
    ),
);
try {
    const files = await migrationsAt(resolve(root, "volcano/migrations"));
    const baseline = process.argv.includes("--adopt-existing-baseline")
        ? (JSON.parse(
              await readFile(
                  resolve(root, "volcano/migration-baseline.json"),
                  "utf8",
              ),
          ) as Baseline)
        : undefined;
    console.log(
        JSON.stringify(
            await applyMigrations(pool, files, revision(), baseline),
        ),
    );
} finally {
    await pool.end();
}
