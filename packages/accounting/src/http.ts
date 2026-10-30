import { ZodError, z } from "zod";
import { AccountingError } from "./types.js";
import type { AccountingService } from "./service.js";
function json(value: unknown, status = 200) {
    return Response.json(value, {
        status,
        headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
    });
}
// Existing released buyers reject unknown descriptor fields. Only clients that
// explicitly understand UDP hints receive them; grant/receipt bytes stay intact.
function buyerJson(value: unknown, request: Request) {
    if (
        request.headers.get("x-panas-peer-addresses") !== "1" &&
        value &&
        typeof value === "object" &&
        "descriptor" in value &&
        value.descriptor &&
        typeof value.descriptor === "object"
    ) {
        const descriptor = { ...value.descriptor } as Record<string, unknown>;
        delete descriptor.peerAddresses;
        return json({ ...value, descriptor });
    }
    return json(value);
}
export function createHttpHandler(service: AccountingService) {
    return async (request: Request): Promise<Response> => {
        try {
            if (request.headers.has("origin"))
                throw new AccountingError(
                    "UNAUTHORIZED",
                    403,
                    "Browser origins are not accepted",
                );
            const url = new URL(request.url);
            if (url.search)
                throw new AccountingError(
                    "INVALID_INPUT",
                    400,
                    "Accounting query arguments are not supported",
                );
            if (!["GET", "POST"].includes(request.method))
                return json(
                    {
                        error: {
                            code: "INVALID_INPUT",
                            message: "Use GET or POST",
                        },
                    },
                    405,
                );
            const raw = request.method === "GET" ? "" : await request.text();
            if (Buffer.byteLength(raw) > 65536)
                throw new AccountingError(
                    "INVALID_INPUT",
                    413,
                    "Accounting request exceeds limit",
                );
            const body = request.method === "GET" ? null : JSON.parse(raw);
            const encoded = request.headers.get("x-panas-proof");
            if (!encoded || encoded.length > 8192)
                throw new AccountingError(
                    "UNAUTHORIZED",
                    401,
                    "Signed cloud authorization required",
                );
            let proof: unknown;
            try {
                proof = JSON.parse(
                    Buffer.from(encoded, "base64url").toString("utf8"),
                );
            } catch {
                throw new AccountingError(
                    "UNAUTHORIZED",
                    401,
                    "Invalid cloud authorization",
                );
            }
            const actor = await service.authenticate(
                proof,
                request.method,
                url.pathname,
                body,
            );
            if (request.method === "POST" && url.pathname === "/balance")
                return json(await service.balance(actor, body));
            if (
                request.method === "POST" &&
                url.pathname === "/funding/solana-devnet/intents"
            )
                return json(await service.createFundingIntent(actor, body));
            if (
                request.method === "POST" &&
                url.pathname === "/funding/solana-devnet/confirm"
            )
                return json(await service.confirmFunding(actor, body));
            if (request.method === "POST" && url.pathname === "/quotes")
                return json(await service.quote(actor, body));
            if (request.method === "POST" && url.pathname === "/purchases")
                return buyerJson(await service.purchase(actor, body), request);
            if (
                request.method === "POST" &&
                url.pathname === "/provider/descriptor"
            )
                return json(await service.uploadDescriptor(actor, body));
            const match =
                /^\/(provider\/)?requests\/([a-f0-9-]+)(?:\/(authorize|terminal|cancel))?$/.exec(
                    url.pathname,
                );
            if (!match)
                return json(
                    {
                        error: {
                            code: "NOT_FOUND",
                            message: "Accounting route not found",
                        },
                    },
                    404,
                );
            const id = z.uuid().parse(match[2]);
            if (request.method === "GET" && !match[1] && !match[3])
                return buyerJson(await service.getRequest(actor, id), request);
            if (
                request.method === "POST" &&
                match[1] &&
                match[3] === "authorize"
            )
                return json(await service.authorize(actor, id, body));
            if (
                request.method === "POST" &&
                match[1] &&
                match[3] === "terminal"
            )
                return json(await service.terminal(actor, id, body));
            if (
                request.method === "POST" &&
                !match[1] &&
                match[3] === "cancel"
            ) {
                z.object({}).strict().parse(body);
                return json(await service.cancel(actor, id));
            }
            return json(
                {
                    error: {
                        code: "NOT_FOUND",
                        message: "Accounting route not found",
                    },
                },
                404,
            );
        } catch (error) {
            if (error instanceof AccountingError)
                return json(
                    { error: { code: error.code, message: error.message } },
                    error.status,
                );
            if (error instanceof ZodError || error instanceof SyntaxError)
                return json(
                    {
                        error: {
                            code: "INVALID_INPUT",
                            message: "Invalid accounting request",
                        },
                    },
                    400,
                );
            return json(
                {
                    error: {
                        code: "UNAVAILABLE",
                        message: "Accounting temporarily unavailable",
                    },
                },
                503,
            );
        }
    };
}
