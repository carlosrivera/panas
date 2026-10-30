import { edgePostgresPool } from "./postgres-pool.js";
import { createPublicKey } from "node:crypto";
import { AccountingService } from "../../packages/accounting/src/service.js";
import { createHttpHandler as accountingHttp } from "../../packages/accounting/src/http.js";
import { SolanaDevnetVerifier } from "../../packages/accounting/src/solana-devnet.js";
import { RegistryService } from "../../packages/registry/src/service.js";
import { PostgresRegistryRepository } from "../../packages/registry/src/repository.js";
import { createHttpHandler as registryHttp } from "../../packages/registry/src/http.js";
import { reconcileMetadata } from "../platform/operations.js";

export interface Env {
    PANAS_REGISTRY_DATABASE_URL: string;
    PANAS_PLATFORM_PRIVATE_KEY_BASE64: string;
    PANAS_DESCRIPTOR_KEY_BASE64: string;
    PANAS_DISCOVERY_TOKEN_SHA256: string;
    PANAS_SOLANA_DEVNET_RPC_URL?: string;
    PANAS_SOLANA_DEVNET_TREASURY_OWNER?: string;
    PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT?: string;
    RELEASE_SHA: string;
    ENROLLMENT_LIMIT: {
        limit(options: { key: string }): Promise<{ success: boolean }>;
    };
}
function poolFor(env: Env) {
    return edgePostgresPool(env.PANAS_REGISTRY_DATABASE_URL);
}
function reportInfrastructureError(error: unknown, operation = "other") {
    const e = error as {
        name?: unknown;
        code?: unknown;
        panasQueryHash?: string;
        message?: string;
    };
    console.warn(
        JSON.stringify({
            event: "api_infrastructure_failure",
            operation,
            queryHash: e?.panasQueryHash,
            inputType: e?.message?.match(
                /^invalid input syntax for type ([a-zA-Z0-9 ]+):/,
            )?.[1],
            type:
                typeof e?.name === "string" && /^[a-zA-Z]{1,40}$/.test(e.name)
                    ? e.name
                    : "Error",
            code:
                typeof e?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(e.code)
                    ? e.code
                    : null,
        }),
    );
}

function unavailable() {
    return Response.json(
        {
            error: {
                code: "UNAVAILABLE",
                message: "API temporarily unavailable",
            },
        },
        { status: 503, headers: { "cache-control": "no-store" } },
    );
}
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const section = /^\/(registry|accounting)(\/|$)/.exec(
            url.pathname,
        )?.[1];
        if (!section) return new Response("Not found", { status: 404 });
        url.pathname = url.pathname.slice(section.length + 1) || "/";
        if (section === "accounting" && url.pathname === "/demo/enroll") {
            if (request.method !== "POST")
                return new Response("Use POST", { status: 405 });
            const limit = await env.ENROLLMENT_LIMIT.limit({
                key: request.headers.get("CF-Connecting-IP") ?? "unknown",
            });
            if (!limit.success)
                return Response.json(
                    {
                        error: {
                            code: "RATE_LIMITED",
                            message: "Try enrollment again shortly",
                        },
                    },
                    {
                        status: 429,
                        headers: {
                            "retry-after": "60",
                            "cache-control": "no-store",
                        },
                    },
                );
        }
        if (request.body) {
            const reader = request.body.getReader(),
                chunks: Uint8Array[] = [];
            let bytes = 0;
            const maxBytes = url.pathname === "/demo/enroll" ? 16384 : 65536;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > maxBytes) {
                    await reader.cancel();
                    return new Response("Request too large", { status: 413 });
                }
                chunks.push(value);
            }
            request = new Request(request, {
                body: new TextDecoder().decode(Buffer.concat(chunks)),
            });
        }
        const pool = poolFor(env);
        const operation = [
            "/quotes",
            "/purchases",
            "/balance",
            "/demo/enroll",
            "/provider/descriptor",
            "/providers/register",
            "/providers/heartbeat",
        ].includes(url.pathname)
            ? url.pathname
            : /^\/provider\/requests\//.test(url.pathname)
              ? "provider-request"
              : /^\/requests\//.test(url.pathname)
                ? "buyer-request"
                : "other";
        try {
            const key = Buffer.from(
                env.PANAS_PLATFORM_PRIVATE_KEY_BASE64,
                "base64",
            ).toString("utf8");
            const routed = new Request(url, request);
            const response =
                section === "registry"
                    ? await registryHttp(
                          new RegistryService(
                              new PostgresRegistryRepository(pool),
                          ),
                          env.PANAS_DISCOVERY_TOKEN_SHA256,
                          createPublicKey(key)
                              .export({ type: "spki", format: "pem" })
                              .toString(),
                          (error) =>
                              reportInfrastructureError(error, "registry-read"),
                      )(routed)
                    : await accountingHttp(
                          new AccountingService(pool, {
                              platformPrivateKey: key,
                              descriptorEncryptionKey: Buffer.from(
                                  env.PANAS_DESCRIPTOR_KEY_BASE64,
                                  "base64",
                              ),
                              ...(env.PANAS_SOLANA_DEVNET_TREASURY_OWNER &&
                              env.PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT
                                  ? {
                                        solanaDevnet: new SolanaDevnetVerifier({
                                            rpcUrl:
                                                env.PANAS_SOLANA_DEVNET_RPC_URL ??
                                                "https://api.devnet.solana.com",
                                            treasuryOwner:
                                                env.PANAS_SOLANA_DEVNET_TREASURY_OWNER,
                                            treasuryTokenAccount:
                                                env.PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT,
                                        }),
                                    }
                                  : {}),
                          }),
                          (error) =>
                              reportInfrastructureError(error, operation),
                      )(routed);
            // Consume JSON MCP replies before closing this invocation's DB sockets.
            const body = await response.arrayBuffer();
            const headers = new Headers(response.headers);
            headers.set("x-panas-api-host", "cloudflare-workers");
            return new Response(body.byteLength ? body : null, {
                status: response.status,
                headers,
            });
        } catch (error) {
            reportInfrastructureError(error, operation);
            return unavailable();
        } finally {
            await pool.end();
        }
    },
    async scheduled(_event: unknown, env: Env) {
        const pool = poolFor(env);
        try {
            await reconcileMetadata(pool, env.RELEASE_SHA);
        } finally {
            await pool.end();
        }
    },
};
