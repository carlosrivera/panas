import { sqlStatements } from "../../../scripts/sql-statements.js";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
const connectionString =
    process.env.PANAS_REGISTRY_DATABASE_URL ??
    process.env.PANAS_ACCOUNTING_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Load a private database environment");
const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
});
await client.connect();
try {
    const dir = new URL("../../../volcano/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
        .filter((v) => /^0[2-9]\d_.*\.sql$/.test(v))
        .sort()) {
        for (const statement of sqlStatements(
            await readFile(new URL(name, dir), "utf8"),
        ))
            await client.query(statement);
        console.log(`Applied ${name}`);
    }
} finally {
    await client.end();
}
