import { SolanaDevnetVerifier } from "./solana-devnet.js";
import pg from "pg";
import { AccountingService } from "./service.js";
import { createHttpHandler } from "./http.js";
interface HttpEvent {
    __volcano_http?: boolean;
    method?: string;
    path?: string;
    raw_query_string?: string;
    headers?: Record<string, string[]>;
    body?: string;
    is_base64_encoded?: boolean;
}
let service: AccountingService | undefined;
export async function handler(event: HttpEvent) {
    if (event.__volcano_http !== true)
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: {
                    code: "INVALID_INPUT",
                    message: "Use HTTP accounting endpoint",
                },
            }),
        };
    const database = process.env.PANAS_REGISTRY_DATABASE_URL,
        key = process.env.PANAS_PLATFORM_PRIVATE_KEY_BASE64,
        ticketKey = process.env.PANAS_DESCRIPTOR_KEY_BASE64;
    if (!database || !key || !ticketKey)
        return {
            statusCode: 503,
            body: JSON.stringify({
                error: {
                    code: "UNAVAILABLE",
                    message: "Accounting configuration unavailable",
                },
            }),
        };
    if (!service) {
        const pool = new pg.Pool({
            connectionString: database,
            max: 3,
            connectionTimeoutMillis: 5000,
            query_timeout: 15000,
            idleTimeoutMillis: 15000,
        });
        pool.on("error", () =>
            console.warn(
                "Panas accounting idle connection failed; subsequent request will reconnect",
            ),
        );
        service = new AccountingService(pool, {
            platformPrivateKey: Buffer.from(key, "base64").toString("utf8"),
            descriptorEncryptionKey: Buffer.from(ticketKey, "base64"),
            ...(process.env.PANAS_SOLANA_DEVNET_TREASURY_OWNER &&
            process.env.PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT
                ? {
                      solanaDevnet: new SolanaDevnetVerifier({
                          rpcUrl:
                              process.env.PANAS_SOLANA_DEVNET_RPC_URL ??
                              "https://api.devnet.solana.com",
                          treasuryOwner:
                              process.env.PANAS_SOLANA_DEVNET_TREASURY_OWNER,
                          treasuryTokenAccount:
                              process.env
                                  .PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT,
                      }),
                  }
                : {}),
        });
    }
    const headers = new Headers();
    for (const [name, values] of Object.entries(event.headers ?? {}))
        for (const value of values) headers.append(name, value);
    const method = event.method ?? "GET",
        body = ["GET", "HEAD"].includes(method)
            ? undefined
            : Buffer.from(
                  event.body ?? "",
                  event.is_base64_encoded ? "base64" : "utf8",
              ).toString("utf8");
    const response = await createHttpHandler(service)(
        new Request(
            `https://accounting.panas.invalid${event.path ?? "/"}${event.raw_query_string ? "?" + event.raw_query_string : ""}`,
            { method, headers, ...(body === undefined ? {} : { body }) },
        ),
    );
    return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
    };
}
