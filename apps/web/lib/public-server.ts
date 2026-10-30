import { serviceUrl } from "@panas/contracts/service-url";
import {
    publicDiscoveryQuerySchema,
    publicProviderPageSchema,
    publicProviderDetailSchema,
} from "@panas/contracts/public-registry";
import { z } from "zod";
const unavailable = {
    error: {
        code: "REGISTRY_UNAVAILABLE",
        message: "Provider data is unavailable. Try refreshing shortly.",
    },
};
function response(value: unknown, status = 200) {
    return Response.json(value, {
        status,
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
export function parsePublicQuery(params: URLSearchParams) {
    const values: Record<string, unknown> = {};
    for (const [key, value] of params) {
        if (Object.hasOwn(values, key)) throw new Error("Duplicate filter");
        values[key] = [
            "limit",
            "minContextTokens",
            "minOutputTokens",
            "maxLatencyMs",
        ].includes(key)
            ? Number(value)
            : key === "readyOnly"
              ? value === "true"
                  ? true
                  : value === "false"
                    ? false
                    : value
              : value;
    }
    return publicDiscoveryQuerySchema.parse(values);
}
export function createPublicRead(options: {
    url?: string | undefined;
    fetch?: typeof fetch;
}) {
    return async function read(
        params: URLSearchParams,
        id?: string,
    ): Promise<Response> {
        let suffix: string;
        try {
            if (id) {
                z.uuid().parse(id);
                suffix = `/public/providers/${id}`;
            } else {
                const parsed = parsePublicQuery(params);
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries(parsed))
                    if (value !== undefined) query.set(key, String(value));
                suffix = `/public/providers?${query}`;
            }
        } catch {
            return response(
                {
                    error: {
                        code: "INVALID_FILTERS",
                        message:
                            "Use valid provider filters or a valid provider identifier.",
                    },
                },
                400,
            );
        }
        if (!options.url) return response(unavailable, 503);
        try {
            const base = new URL(options.url);
            if (
                base.username ||
                base.password ||
                base.search ||
                base.hash ||
                !(
                    base.protocol === "https:" ||
                    (base.protocol === "http:" &&
                        ["127.0.0.1", "localhost"].includes(base.hostname))
                )
            )
                return response(unavailable, 503);
            const upstream = await (options.fetch ?? fetch)(
                serviceUrl(base, suffix),
                {
                    cache: "no-store",
                    credentials: "omit",
                    redirect: "error",
                    headers: { accept: "application/json" },
                    signal: AbortSignal.timeout(8000),
                },
            );
            if (upstream.status === 404 && id)
                return response(
                    {
                        error: {
                            code: "NOT_FOUND",
                            message:
                                "This provider is not in the public registry.",
                        },
                    },
                    404,
                );
            if (upstream.status === 400)
                return response(
                    {
                        error: {
                            code: "INVALID_FILTERS",
                            message:
                                "Use valid filters or reset an expired page cursor.",
                        },
                    },
                    400,
                );
            if (!upstream.ok) return response(unavailable, 503);
            const reader = upstream.body?.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            if (reader) {
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        bytes += value.byteLength;
                        if (bytes > 262144) {
                            await reader.cancel();
                            throw new Error("Oversized registry response");
                        }
                        chunks.push(value);
                    }
                } finally {
                    reader.releaseLock();
                }
            }
            const data: unknown = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
            );
            // Strict shared schemas reject private/unknown nested fields before the browser sees bytes.
            const parsed = id
                ? publicProviderDetailSchema.parse(data)
                : publicProviderPageSchema.parse(data);
            return response(parsed);
        } catch {
            return response(unavailable, 503);
        }
    };
}
