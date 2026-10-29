import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import pg from "pg";
const { values } = parseArgs({
    options: {
        "provider-id": { type: "string" },
        "public-key-file": { type: "string" },
    },
});
const providerId = z.uuid().parse(values["provider-id"]);
if (!values["public-key-file"] || !process.env.PANAS_REGISTRY_DATABASE_URL)
    throw new Error(
        "Provider public key file and private database configuration are required",
    );
const key = createPublicKey(await readFile(values["public-key-file"], "utf8"));
if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Prototype providers require an Ed25519 public key");
const pool = new pg.Pool({
    connectionString: process.env.PANAS_REGISTRY_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
});
try {
    await pool.query(
        "INSERT INTO panas_provider_keys(provider_id,public_key_pem) VALUES($1,$2) ON CONFLICT(provider_id) DO UPDATE SET public_key_pem=EXCLUDED.public_key_pem,enabled=true",
        [providerId, key.export({ type: "spki", format: "pem" }).toString()],
    );
    console.log(
        `Enrolled provider ${providerId}; no private key is stored by the registry.`,
    );
} finally {
    await pool.end();
}
