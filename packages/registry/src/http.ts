import { z, ZodError } from "zod";
import { discoveryQuerySchema } from "@panas/contracts/registry";
import { verifyDemoDiscovery } from "@panas/protocol";
import { checkDiscoveryToken, type RequestProof } from "./auth.js";
import { RegistryError } from "./errors.js";
import { toPublicPage, toPublicDetail, publicQueryFromUrl } from "./public.js";
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
    demoPublicKey?: string,
) {
    return async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        const publicGet =
            request.method === "GET" &&
            (path === "/public/providers" ||
                /^\/public\/providers\/[^/]+$/.test(path));
        const respond = (body: unknown, status = 200) => {
            const response = jsonResponse(body, status);
            if (publicGet) {
                response.headers.set("Access-Control-Allow-Origin", "*");
                response.headers.set("Access-Control-Allow-Methods", "GET");
            }
            return response;
        };
        try {
            const url = new URL(request.url);
            // Anonymous GET only: safe informational projection, never an authorization boundary.
            if (
                request.method === "GET" &&
                (url.pathname === "/public/providers" ||
                    /^\/public\/providers\/[^/]+$/.test(url.pathname))
            ) {
                const query =
                    path === "/public/providers"
                        ? publicQueryFromUrl(new URL(request.url))
                        : null;
                const id = query
                    ? null
                    : z.uuid().parse(path.split("/")[3] ?? "");
                try {
                    const value = query
                        ? toPublicPage(await service.discover(query))
                        : toPublicDetail(
                              await service.getProvider(id!),
                              new Date().toISOString(),
                          );
                    return respond(value);
                } catch (error) {
                    if (error instanceof RegistryError) throw error;
                    throw new RegistryError(
                        "UNAVAILABLE",
                        503,
                        "Public provider data is temporarily unavailable",
                    );
                }
            }
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
                    return respond(
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
                return respond(result);
            }
            let freeOnly = false;
            try {
                checkDiscoveryToken(
                    request.headers.get("authorization"),
                    tokenHash,
                );
            } catch (error) {
                if (!demoPublicKey) throw error;
                try {
                    verifyDemoDiscovery(
                        (request.headers.get("authorization") ?? "").replace(
                            /^Bearer /,
                            "",
                        ),
                        demoPublicKey,
                    );
                    freeOnly = true;
                } catch {
                    throw error;
                }
            }
            const discovery = freeOnly
                ? {
                      discover: (
                          query: Parameters<RegistryService["discover"]>[0],
                      ) =>
                          service.discover({
                              ...discoveryQuerySchema.parse(query),
                              maxPriceAtomic: "0",
                          }),
                      getProvider: async (id: string) => {
                          const provider = await service.getProvider(id);
                          if (provider.price.totalAtomic !== "0")
                              throw new RegistryError(
                                  "UNAUTHORIZED",
                                  403,
                                  "Demo discovery is limited to free providers",
                              );
                          return provider;
                      },
                  }
                : service;
            if (url.pathname === "/mcp")
                return await handleMcp(request, discovery);
            if (request.method === "GET" && url.pathname === "/providers")
                return respond(await discovery.discover(queryFromUrl(url)));
            if (
                request.method === "GET" &&
                /^\/providers\/[^/]+$/.test(url.pathname)
            )
                return respond(
                    await discovery.getProvider(
                        url.pathname.split("/")[2] ?? "",
                    ),
                );
            return respond(
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
                return respond(
                    { error: { code: error.code, message: error.message } },
                    error.status,
                );
            if (error instanceof ZodError || error instanceof SyntaxError)
                return respond(
                    {
                        error: {
                            code: "INVALID_INPUT",
                            message: "Invalid registry request",
                        },
                    },
                    400,
                );
            // Never send SQL diagnostics, connection strings, request bodies, or credentials to clients/logs.
            return respond(
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
