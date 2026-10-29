import { ZodError } from "zod";
import { checkDiscoveryToken, type RequestProof } from "./auth.js";
import { RegistryError } from "./errors.js";
import { handleMcp } from "./mcp.js";
import { queryFromUrl, type RegistryService } from "./service.js";

export function jsonResponse(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
export function createHttpHandler(
    service: RegistryService,
    tokenHash: string | undefined,
) {
    return async (request: Request): Promise<Response> => {
        try {
            const url = new URL(request.url);
            // This endpoint is for agent clients, not credential-bearing browser requests.
            if (request.headers.has("origin"))
                throw new RegistryError(
                    "UNAUTHORIZED",
                    403,
                    "Browser origins are not accepted",
                );
            if (
                request.method === "POST" &&
                ["/providers/register", "/providers/heartbeat"].includes(
                    url.pathname,
                )
            ) {
                if (
                    !request.headers
                        .get("content-type")
                        ?.startsWith("application/json")
                )
                    return jsonResponse(
                        {
                            error: {
                                code: "INVALID_INPUT",
                                message: "Expected application/json",
                            },
                        },
                        415,
                    );
                const rawBody = await request.text();
                if (Buffer.byteLength(rawBody) > 65536)
                    throw new RegistryError(
                        "INVALID_INPUT",
                        413,
                        "Request body exceeds registry limit",
                    );
                const proof: RequestProof = {
                    providerId:
                        request.headers.get("x-panas-provider-id") ?? "",
                    timestamp: request.headers.get("x-panas-timestamp") ?? "",
                    nonce: request.headers.get("x-panas-nonce") ?? "",
                    signature: request.headers.get("x-panas-signature") ?? "",
                };
                const result = url.pathname.endsWith("/register")
                    ? await service.register(rawBody, proof)
                    : await service.heartbeat(rawBody, proof);
                return jsonResponse(result);
            }
            checkDiscoveryToken(
                request.headers.get("authorization"),
                tokenHash,
            );
            if (url.pathname === "/mcp")
                return await handleMcp(request, service);
            if (request.method === "GET" && url.pathname === "/providers")
                return jsonResponse(await service.discover(queryFromUrl(url)));
            if (
                request.method === "GET" &&
                /^\/providers\/[^/]+$/.test(url.pathname)
            )
                return jsonResponse(
                    await service.getProvider(url.pathname.split("/")[2] ?? ""),
                );
            return jsonResponse(
                {
                    error: {
                        code: "NOT_FOUND",
                        message: "Registry route not found",
                    },
                },
                404,
            );
        } catch (error) {
            if (error instanceof RegistryError)
                return jsonResponse(
                    { error: { code: error.code, message: error.message } },
                    error.status,
                );
            if (error instanceof ZodError || error instanceof SyntaxError)
                return jsonResponse(
                    {
                        error: {
                            code: "INVALID_INPUT",
                            message: "Invalid registry request",
                        },
                    },
                    400,
                );
            // Never send SQL diagnostics, connection strings, request bodies, or credentials to clients/logs.
            return jsonResponse(
                {
                    error: {
                        code: "UNAVAILABLE",
                        message: "Registry temporarily unavailable",
                    },
                },
                503,
            );
        }
    };
}
