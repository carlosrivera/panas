import { createHash } from "node:crypto";
import postgres from "postgres";
import type { Pool } from "pg";

/** The service's query/connect interface, with one request-owned connection. */
export function edgePostgresPool(connectionString: string): Pool {
    const url = new URL(connectionString);
    const sql = postgres(connectionString, {
        max: 1,
        prepare: false,
        types: {
            json: {
                to: 114,
                from: [114],
                serialize: (value: unknown) =>
                    typeof value === "string" ? value : JSON.stringify(value),
                parse: JSON.parse,
            },
            jsonb: {
                to: 3802,
                from: [3802],
                serialize: (value: unknown) =>
                    typeof value === "string" ? value : JSON.stringify(value),
                parse: JSON.parse,
            },
        },
        connect_timeout: 5,
        idle_timeout: 1,
        connection: {
            application_name:
                url.searchParams.get("application_name") ?? "panas-api",
            statement_timeout: 15000,
        },
        onnotice: () => {},
    });
    type Query = typeof sql.unsafe;
    const query = async (
        executor: Query,
        text: string,
        values: unknown[] = [],
    ) => {
        // Match node-postgres JSON/date binding while retaining native boolean
        // and bytea values for Postgres.js's type-specific serializers.
        const parameter = (
            value: unknown,
        ): string | boolean | Uint8Array | null => {
            if (value === null || value === undefined) return null;
            if (typeof value === "boolean") return value;
            if (value instanceof Date) return value.toISOString();
            if (value instanceof Uint8Array) return value;
            if (Array.isArray(value))
                return (
                    "{" +
                    value
                        .map((item) => {
                            const normalized = parameter(item);
                            return normalized === null
                                ? "NULL"
                                : '"' +
                                      String(normalized)
                                          .replace(/\\/g, "\\\\")
                                          .replace(/"/g, '\\"') +
                                      '"';
                        })
                        .join(",") +
                    "}"
                );
            return typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
        };
        try {
            const rows = await executor(
                text,
                values.map(parameter) as Parameters<Query>[1],
            );
            return { rows: Array.from(rows), rowCount: rows.count };
        } catch (error) {
            if (error && typeof error === "object")
                Object.defineProperty(error, "panasQueryHash", {
                    value: createHash("sha256")
                        .update(text)
                        .digest("hex")
                        .slice(0, 12),
                });
            throw error;
        }
    };
    return {
        query: (text: string, values?: unknown[]) =>
            query(sql.unsafe, text, values),
        connect: async () => {
            // Postgres.js must open its socket before reserve() in workerd.
            await sql.unsafe("SELECT 1");
            const reserved = await sql.reserve();
            return {
                query: (text: string, values?: unknown[]) =>
                    query(reserved.unsafe, text, values),
                release: () => reserved.release(),
            };
        },
        end: () => sql.end(),
    } as unknown as Pool;
}
