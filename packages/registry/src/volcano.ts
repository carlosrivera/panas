import pg from "pg";
import { createHttpHandler } from "./http.js";
import { PostgresRegistryRepository } from "./repository.js";
import { RegistryService } from "./service.js";

export interface VolcanoHttpEvent {
    __volcano_http?: boolean;
    method?: string;
    path?: string;
    raw_query_string?: string;
    headers?: Record<string, string[]>;
    body?: string;
    is_base64_encoded?: boolean;
}
let pool: pg.Pool | undefined;
export async function handler(event: VolcanoHttpEvent) {
    if (event.__volcano_http !== true)
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: {
                    code: "INVALID_INPUT",
                    message: "Use the registry HTTP endpoint",
                },
            }),
        };
    const connectionString = process.env.PANAS_REGISTRY_DATABASE_URL;
    if (!connectionString)
        return {
            statusCode: 503,
            body: JSON.stringify({
                error: {
                    code: "UNAVAILABLE",
                    message: "Registry storage is not configured",
                },
            }),
        };
    if (!pool) {
        pool = new pg.Pool({
            connectionString,
            max: 2,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 15000,
            query_timeout: 10000,
        });
        pool.on("error", () => {
            console.warn(
                "Panas registry idle database connection failed; next request will reconnect",
            );
        });
    }
    const headers = new Headers();
    for (const [key, values] of Object.entries(event.headers ?? {}))
        for (const value of values) headers.append(key, value);
    const method = event.method ?? "GET";
    const body = ["GET", "HEAD"].includes(method)
        ? undefined
        : Buffer.from(
              event.body ?? "",
              event.is_base64_encoded ? "base64" : "utf8",
          ).toString("utf8");
    // The host is fixed and never trusted for redirect, authorization, or link generation.
    const request = new Request(
        `https://registry.panas.invalid${event.path ?? "/"}${event.raw_query_string ? `?${event.raw_query_string}` : ""}`,
        { method, headers, ...(body === undefined ? {} : { body }) },
    );
    const response = await createHttpHandler(
        new RegistryService(new PostgresRegistryRepository(pool)),
        process.env.PANAS_DISCOVERY_TOKEN_SHA256,
    )(request);
    return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
    };
}
