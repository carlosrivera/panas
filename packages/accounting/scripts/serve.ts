import { createServer } from "node:http";
import pg from "pg";
import { AccountingService } from "../src/service.js";
import { createHttpHandler } from "../src/http.js";
const database = process.env.PANAS_REGISTRY_DATABASE_URL,
    key = process.env.PANAS_PLATFORM_PRIVATE_KEY_BASE64,
    ticket = process.env.PANAS_DESCRIPTOR_KEY_BASE64;
if (!database || !key || !ticket)
    throw new Error("Load private accounting environment");
const pool = new pg.Pool({
    connectionString: database,
    max: 5,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
});
pool.on("error", () => console.warn("Accounting idle connection failed"));
const handle = createHttpHandler(
    new AccountingService(pool, {
        platformPrivateKey: Buffer.from(key, "base64").toString("utf8"),
        descriptorEncryptionKey: Buffer.from(ticket, "base64"),
    }),
);
const port = Number(process.env.PANAS_ACCOUNTING_PORT ?? 4444);
const server = createServer(async (req, res) => {
    try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > 65536) {
                res.writeHead(413);
                res.end();
                return;
            }
            chunks.push(chunk as Buffer);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers))
            if (value !== undefined)
                headers.set(
                    name,
                    Array.isArray(value) ? value.join(",") : value,
                );
        const method = req.method ?? "GET",
            body = ["GET", "HEAD"].includes(method)
                ? undefined
                : Buffer.concat(chunks).toString("utf8");
        const response = await handle(
            new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
                method,
                headers,
                ...(body === undefined ? {} : { body }),
            }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
    } catch {
        res.writeHead(503);
        res.end(
            JSON.stringify({
                error: {
                    code: "UNAVAILABLE",
                    message: "Accounting unavailable",
                },
            }),
        );
    }
});
server.listen(port, "127.0.0.1", () =>
    console.log(`Panas test-credit accounting at http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
        server.close(() => {
            void pool.end().then(() => process.exit(0));
        });
    });
