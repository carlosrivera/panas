// Applies migrations only to an explicitly configured local test database.
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
const connectionString = process.env.PANAS_ACCOUNTING_TEST_DATABASE_URL;
if (!connectionString)
    throw new Error("Set the isolated local accounting test database URL");
const url = new URL(connectionString);
if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^\/panas_.*test$/.test(url.pathname)
)
    throw new Error("Use an isolated local panas_*test database");
const client = new pg.Client({ connectionString });
await client.connect();
try {
    const directory = new URL("../volcano/migrations/", import.meta.url);
    for (const file of (await readdir(directory))
        .filter((v) => /^\d{3}_.*\.sql$/.test(v))
        .sort())
        await client.query(await readFile(new URL(file, directory), "utf8"));
    console.log("Isolated accounting test migrations applied.");
} finally {
    await client.end();
}
