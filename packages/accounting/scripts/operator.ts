import { readFile } from "node:fs/promises";
import pg from "pg";
import { AccountingService } from "../src/service.js";
const [action, file] = process.argv.slice(2);
if (!file)
    throw new Error(
        "Use operator.ts enroll-buyer|open-session|fund|resolve /private/path/input.json",
    );
const database = process.env.PANAS_REGISTRY_DATABASE_URL,
    key = process.env.PANAS_PLATFORM_PRIVATE_KEY_BASE64,
    ticket = process.env.PANAS_DESCRIPTOR_KEY_BASE64;
if (!database || !key || !ticket)
    throw new Error(
        "Load operator configuration from a private environment file",
    );
const pool = new pg.Pool({
    connectionString: database,
    max: 1,
    connectionTimeoutMillis: 10000,
});
const service = new AccountingService(pool, {
    platformPrivateKey: Buffer.from(key, "base64").toString("utf8"),
    descriptorEncryptionKey: Buffer.from(ticket, "base64"),
});
try {
    const input = JSON.parse(await readFile(file, "utf8"));
    switch (action) {
        case "enroll-buyer":
            await service.operatorEnrollBuyer(input);
            console.log("Buyer enrollment/policy saved");
            break;
        case "open-session":
            await service.operatorOpenSession(input);
            console.log("Owner session configured");
            break;
        case "fund":
            console.log(JSON.stringify(await service.operatorFund(input)));
            break;
        case "resolve":
            console.log(JSON.stringify(await service.operatorResolve(input)));
            break;
        default:
            throw new Error("Unknown operator action");
    }
} finally {
    await pool.end();
}
