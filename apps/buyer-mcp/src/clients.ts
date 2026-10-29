import { randomUUID, type KeyLike } from "node:crypto";
import { z } from "zod";
import { requestLimitsSchema } from "@panas/contracts";
import { registryPriceSchema } from "@panas/contracts/registry";
import {
    canonicalJson,
    cloudRequestSchema,
    digest,
    DOMAIN,
    signDocument,
    type WireRequest,
    type Quote,
} from "@panas/protocol";
import { superviseJoin } from "@panas/mcpwire";
import { BuyerError, type BuyerErrorCode } from "./errors";
import type { PrivateDescriptor } from "./state";

export interface CloudClient {
    quote(body: {
        providerId: string;
        sessionId: string;
        requestId: string;
        payloadDigest: string;
        maxOutputTokens: number;
    }): Promise<unknown>;
    purchase(body: {
        quoteId: string;
        idempotencyKey: string;
    }): Promise<unknown>;
    get(requestId: string): Promise<unknown>;
    cancel(requestId: string): Promise<unknown>;
}
export interface DiscoveryClient {
    discover(input: unknown): Promise<unknown>;
    getProvider(providerId: string): Promise<unknown>;
}
export interface PeerClient {
    call(
        descriptor: PrivateDescriptor,
        operation: WireRequest,
        timeoutMs: number,
    ): Promise<unknown>;
}
const messages: Record<string, string> = {
    INVALID_INPUT: "Invalid buyer request",
    UNAUTHORIZED: "Buyer authorization rejected",
    NOT_FOUND: "Owned request or provider not found",
    CONFLICT: "Request conflicts with existing state",
    PROVIDER_UNAVAILABLE: "Selected provider is unavailable; discover again",
    QUOTE_EXPIRED: "Accepted quote or authorization expired",
    SPENDING_LIMIT: "Owner spending limit exceeded",
    UNAVAILABLE: "Cloud service unavailable",
    PENDING_RECONCILIATION: "Request outcome is pending reconciliation",
};
const safeCodeSchema = z.enum([
    "INVALID_INPUT",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "CONFLICT",
    "PROVIDER_UNAVAILABLE",
    "QUOTE_EXPIRED",
    "SPENDING_LIMIT",
    "UNAVAILABLE",
    "PENDING_RECONCILIATION",
]);
async function readResponse(response: Response): Promise<unknown> {
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 1_048_576)
        throw new BuyerError(
            "UNAVAILABLE",
            "Service response exceeded safe size",
        );
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader) {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 1_048_576) {
                    await reader.cancel();
                    throw new BuyerError(
                        "UNAVAILABLE",
                        "Service response exceeded safe size",
                    );
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (Buffer.byteLength(text) > 1_048_576)
        throw new BuyerError(
            "UNAVAILABLE",
            "Service response exceeded safe size",
        );
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new BuyerError(
            "UNAVAILABLE",
            "Service returned an invalid response",
        );
    }
    if (!response.ok) {
        const parsed = z
            .object({ error: z.object({ code: safeCodeSchema }) })
            .safeParse(value);
        const code: BuyerErrorCode = parsed.success
            ? parsed.data.error.code
            : "UNAVAILABLE";
        throw new BuyerError(
            code,
            messages[code] ?? "Service operation unavailable",
        );
    }
    return value;
}
export function createCloudClient(options: {
    url: string;
    buyerId: string;
    privateKey: KeyLike;
    fetch?: typeof fetch;
    clock?: () => Date;
}): CloudClient {
    const send = async (
        method: "GET" | "POST",
        path: string,
        body: unknown = null,
    ) => {
        const now = (options.clock ?? (() => new Date()))();
        const proof = signDocument(
            DOMAIN.cloud,
            cloudRequestSchema.parse({
                version: 1,
                actor: "buyer",
                actorId: options.buyerId,
                method,
                path,
                bodyDigest: digest(body),
                nonce: randomUUID(),
                issuedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 60_000).toISOString(),
            }),
            options.privateKey,
        );
        try {
            return await readResponse(
                await (options.fetch ?? fetch)(new URL(path, options.url), {
                    method,
                    redirect: "error",
                    headers: {
                        "content-type": "application/json",
                        "x-panas-proof": Buffer.from(
                            JSON.stringify(proof),
                        ).toString("base64url"),
                    },
                    ...(method === "POST" ? { body: canonicalJson(body) } : {}),
                    signal: AbortSignal.timeout(15_000),
                }),
            );
        } catch (error) {
            if (error instanceof BuyerError) throw error;
            throw new BuyerError(
                "UNAVAILABLE",
                "Cloud connection unavailable; retain the original request and idempotency key",
            );
        }
    };
    return {
        quote: (body) => send("POST", "/quotes", body),
        purchase: (body) => send("POST", "/purchases", body),
        get: (id) => send("GET", `/requests/${z.uuid().parse(id)}`),
        cancel: (id) =>
            send("POST", `/requests/${z.uuid().parse(id)}/cancel`, {}),
    };
}
export function createDiscoveryClient(options: {
    url: string;
    token: string;
    fetch?: typeof fetch;
}): DiscoveryClient {
    const send = async (path: string) => {
        try {
            return await readResponse(
                await (options.fetch ?? fetch)(new URL(path, options.url), {
                    headers: { authorization: `Bearer ${options.token}` },
                    redirect: "error",
                    signal: AbortSignal.timeout(10_000),
                }),
            );
        } catch (error) {
            if (error instanceof BuyerError) throw error;
            throw new BuyerError(
                "UNAVAILABLE",
                "Discovery service unavailable",
            );
        }
    };
    return {
        discover: (input) => {
            const query = new URLSearchParams();
            for (const [key, value] of Object.entries(
                input as Record<string, unknown>,
            ))
                if (value !== undefined) query.set(key, String(value));
            return send(`/providers?${query}`);
        },
        getProvider: (id) => send(`/providers/${z.uuid().parse(id)}`),
    };
}
export function createPeerClient(): PeerClient & { close(): Promise<void> } {
    const sessions = new Set<ReturnType<typeof superviseJoin>>();
    let closed = false;
    return {
        async close() {
            closed = true;
            await Promise.all([...sessions].map((session) => session.stop()));
        },
        async call(descriptor, envelope, timeoutMs) {
            if (closed)
                throw new BuyerError(
                    "UNAVAILABLE",
                    "Buyer peer client is shutting down",
                );
            const session = superviseJoin({
                ticket: descriptor.ticket,
                startupTimeoutMs: 35_000,
            });
            sessions.add(session);
            try {
                const ready = await session.ready;
                if (ready.kind !== "ready")
                    throw new BuyerError(
                        "UNCERTAIN",
                        "Provider connection failed; retrieve request state before retrying",
                    );
                const result = await session.request(
                    "tools/call",
                    {
                        name: envelope.proof.payload.operation,
                        arguments: envelope,
                    },
                    { timeoutMs },
                );
                const parsed = z
                    .object({
                        isError: z.boolean().optional(),
                        structuredContent: z.unknown(),
                    })
                    .safeParse(result);
                if (
                    !parsed.success ||
                    parsed.data.isError ||
                    parsed.data.structuredContent === undefined
                )
                    throw new BuyerError(
                        "UNCERTAIN",
                        "Provider returned no verifiable response; retrieve original request state",
                    );
                return parsed.data.structuredContent;
            } catch (error) {
                if (error instanceof BuyerError) throw error;
                throw new BuyerError(
                    "UNCERTAIN",
                    "Provider request outcome is uncertain; retrieve the original request state",
                );
            } finally {
                await session.stop();
                sessions.delete(session);
            }
        },
    };
}
/** Select only informational registry fields; never relay arbitrary cloud fields. */
export function safeProvider(value: unknown): Record<string, unknown> {
    const provider = z
        .object({
            providerId: z.uuid(),
            startupId: z.uuid(),
            model: z
                .object({
                    name: z.literal("qwen2.5:0.5b"),
                    digest: z.string().nullable(),
                    runtimeVersion: z.string().nullable(),
                })
                .strict(),
            profile: requestLimitsSchema,
            price: registryPriceSchema,
            state: z.string(),
            readiness: z
                .object({ ready: z.boolean(), reason: z.string().max(100) })
                .strict(),
            testedAt: z.iso.datetime(),
            lastSeenAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
        })
        .parse(value);
    return {
        providerId: provider.providerId,
        startupId: provider.startupId,
        model: provider.model,
        profile: provider.profile,
        price: provider.price,
        state: provider.state,
        readiness: provider.readiness,
        testedAt: provider.testedAt,
        lastSeenAt: provider.lastSeenAt,
        expiresAt: provider.expiresAt,
    };
}
export function assertQuoteOwner(
    quote: Quote,
    expected: {
        buyerId: string;
        buyerKeyId: string;
        sessionId: string;
        providerId: string;
        requestId: string;
        payloadDigest: string;
        maxOutputTokens: number;
    },
    now: Date,
) {
    if (
        quote.buyerId !== expected.buyerId ||
        quote.buyerKeyId !== expected.buyerKeyId ||
        quote.sessionId !== expected.sessionId ||
        quote.providerId !== expected.providerId ||
        quote.requestId !== expected.requestId ||
        quote.payloadDigest !== expected.payloadDigest ||
        quote.limits.maxOutputTokens < expected.maxOutputTokens ||
        Date.parse(quote.expiresAt) <= now.getTime()
    )
        throw new BuyerError(
            "CONFLICT",
            "Cloud quote does not match the owned request",
        );
}
