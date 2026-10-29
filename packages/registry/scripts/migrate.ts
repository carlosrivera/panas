import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
const connectionString = process.env.PANAS_REGISTRY_DATABASE_URL;
if (!connectionString)
    throw new Error(
        "Set PANAS_REGISTRY_DATABASE_URL through a private environment file",
    );
const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
});
await client.connect();
try {
    const directory = new URL("../../../volcano/migrations/", import.meta.url);
    for (const filename of (await readdir(directory))
        .filter((name) => /^01\d_.*\.sql$/.test(name))
        .sort()) {
        await client.query(
            await readFile(new URL(filename, directory), "utf8"),
        );
        console.log(`Applied ${filename}`);
    }
} finally {
    await client.end();
}
