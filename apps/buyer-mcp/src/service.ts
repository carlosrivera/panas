import { randomUUID, type KeyLike } from "node:crypto";
import { z } from "zod";
import { atomicAmountSchema } from "@panas/contracts";
import { discoveryQuerySchema } from "@panas/contracts/registry";
import {
    assertFresh,
    digest,
    DOMAIN,
    inferencePayloadSchema,
    keyId,
    operationSchema,
    providerResultSchema,
    quoteSchema,
    signDocument,
    signedGrantSchema,
    verifyDocument,
    type Quote,
    type Grant,
    type SignedDocument,
    type HostOperation,
} from "@panas/protocol";
import { BuyerError } from "./errors";
import type { OwnerConfig } from "./config";
import {
    assertQuoteOwner,
    safeProvider,
    type CloudClient,
    type DiscoveryClient,
    type PeerClient,
} from "./clients";
import {
    publicQuote,
    validateDescriptor,
    type BuyerState,
    type StoredRequest,
} from "./state";

export interface StateStore {
    load(): BuyerState;
    save(state: BuyerState): void;
}
const purchaseSchema = z.object({
    quote: quoteSchema,
    signedGrant: signedGrantSchema,
    descriptor: z.unknown(),
});
const usageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        durationMs: z.number().nonnegative(),
    })
    .strict();
const receiptSchema = z.object({
    receiptId: z.uuid(),
    requestId: z.uuid(),
    status: z.enum(["completed", "failed", "cancelled", "refunded"]),
    currency: z.literal("TEST_CREDIT"),
    buyerDebitAtomic: atomicAmountSchema,
    providerEarningsAtomic: atomicAmountSchema,
    feeAtomic: atomicAmountSchema,
    issuedAt: z.iso.datetime(),
    resultDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable()
        .optional(),
    usage: usageSchema.nullable().optional(),
    refundOf: z.uuid().optional(),
});
const cloudStateSchema = z.object({
    requestId: z.uuid(),
    status: z.enum([
        "reserved",
        "authorized",
        "pending",
        "completed",
        "failed",
        "cancelled",
        "refunded",
    ]),
    receipt: receiptSchema.nullable(),
    signedGrant: signedGrantSchema.nullable().optional(),
    descriptor: z.unknown().optional(),
    cancelRequested: z.boolean().optional(),
});
const providerBodySchema = z.object({
    requestId: z.uuid(),
    status: z.enum(["running", "completed", "cancelled", "failed", "unknown"]),
    result: z
        .object({
            text: z.string().max(65536),
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            durationMs: z.number().nonnegative(),
        })
        .strict()
        .optional(),
    updatedAt: z.iso.datetime().optional(),
});
/** Serializes state mutations only. Inference runs outside the lock, allowing cancellation. */
class Mutex {
    private tail: Promise<unknown> = Promise.resolve();
    run<T>(operation: () => Promise<T> | T): Promise<T> {
        const pending = this.tail.then(operation, operation);
        this.tail = pending.catch(() => {});
        return pending;
    }
}
export class BuyerService {
    private readonly mutex = new Mutex();
    private readonly buyerKeyId: string;
    private readonly clock: () => Date;
    constructor(
        private readonly options: {
            owner: OwnerConfig;
            privateKey: KeyLike;
            platformPublicKey: KeyLike;
            store: StateStore;
            cloud: CloudClient;
            discovery: DiscoveryClient;
            peer: PeerClient;
            clock?: () => Date;
        },
    ) {
        this.buyerKeyId = keyId(options.privateKey);
        this.clock = options.clock ?? (() => new Date());
        const state = options.store.load();
        if (state.buyerId !== options.owner.buyerId)
            throw new Error("Buyer store belongs to another owner");
    }
    private record(state: BuyerState, id: string): StoredRequest {
        const record = state.requests[id];
        if (!record)
            throw new BuyerError(
                "NOT_FOUND",
                "Request is not owned by this buyer facade",
            );
        return record;
    }
    private async update<T>(operation: (state: BuyerState) => T): Promise<T> {
        return this.mutex.run(() => {
            const state = this.options.store.load();
            const value = operation(state);
            this.options.store.save(state);
            return value;
        });
    }
    async discover(input: unknown): Promise<Record<string, unknown>> {
        const query = discoveryQuerySchema.parse(input);
        const result = z
            .object({
                providers: z.array(z.unknown()),
                observedAt: z.iso.datetime(),
                nextCursor: z.string().nullable(),
            })
            .parse(await this.options.discovery.discover(query));
        return {
            providers: result.providers.map(safeProvider),
            observedAt: result.observedAt,
            nextCursor: result.nextCursor,
        };
    }
    async getProvider(input: {
        providerId: string;
    }): Promise<Record<string, unknown>> {
        return safeProvider(
            await this.options.discovery.getProvider(
                z.uuid().parse(input.providerId),
            ),
        );
    }
    async quote(input: {
        providerId: string;
        prompt: string;
        maxOutputTokens: number;
    }): Promise<Record<string, unknown>> {
        const payload = inferencePayloadSchema.parse({
            prompt: input.prompt,
            maxOutputTokens: input.maxOutputTokens,
        });
        z.uuid().parse(input.providerId);
        const now = this.clock();
        const requestId = randomUUID();
        await this.update((state) => {
            if (Object.keys(state.requests).length >= 500)
                throw new BuyerError(
                    "UNAVAILABLE",
                    "Local request storage is full; owner maintenance is required",
                );
            state.requests[requestId] = {
                requestId,
                providerId: input.providerId,
                sessionId: this.options.owner.sessionId,
                createdAt: now.toISOString(),
                payload,
                quote: null,
                idempotencyKey: null,
                purchaseState: "draft",
                runState: "not_sent",
                signedGrant: null,
                descriptor: null,
                reservedAtomic: "0",
                spentAtomic: "0",
                budgetDay: null,
            };
        });
        const quote = quoteSchema.parse(
            await this.options.cloud.quote({
                providerId: input.providerId,
                sessionId: this.options.owner.sessionId,
                requestId,
                payloadDigest: digest(payload),
                maxOutputTokens: payload.maxOutputTokens,
            }),
        );
        assertQuoteOwner(
            quote,
            {
                buyerId: this.options.owner.buyerId,
                buyerKeyId: this.buyerKeyId,
                sessionId: this.options.owner.sessionId,
                providerId: input.providerId,
                requestId,
                payloadDigest: digest(payload),
                maxOutputTokens: payload.maxOutputTokens,
            },
            this.clock(),
        );
        if (
            Buffer.byteLength(payload.prompt) >
            quote.limits.maxContextTokens - payload.maxOutputTokens - 16
        )
            throw new BuyerError(
                "INVALID_INPUT",
                "Prompt exceeds the accepted provider's conservative context budget",
            );
        if (keyId(quote.providerPublicKeyPem) !== quote.providerKeyId)
            throw new BuyerError(
                "CONFLICT",
                "Quote provider identity is invalid",
            );
        await this.update((state) => {
            const request = this.record(state, requestId);
            request.quote = quote;
            request.purchaseState = "quoted";
        });
        return publicQuote(quote);
    }
    private enforceBudget(
        state: BuyerState,
        request: StoredRequest,
        quote: Quote,
    ) {
        const limits = this.options.owner.limits;
        const amount = BigInt(quote.totalAtomic);
        const day = this.clock().toISOString().slice(0, 10);
        let session = 0n,
            daily = 0n;
        for (const existing of Object.values(state.requests)) {
            if (existing.requestId === request.requestId) continue;
            const committed =
                BigInt(existing.reservedAtomic) + BigInt(existing.spentAtomic);
            if (existing.sessionId === request.sessionId) session += committed;
            if (existing.budgetDay === day) daily += committed;
        }
        if (
            amount > BigInt(limits.maxRequestAtomic) ||
            session + amount > BigInt(limits.maxSessionAtomic) ||
            daily + amount > BigInt(limits.maxDailyAtomic)
        )
            throw new BuyerError(
                "SPENDING_LIMIT",
                "This purchase exceeds owner-configured spending authority",
            );
        request.reservedAtomic = quote.totalAtomic;
        request.budgetDay = day;
    }
    private checkGrant(
        document: SignedDocument<Grant>,
        quote: Quote,
        operation?: HostOperation,
    ): Grant {
        const grant = signedGrantSchema.parse(document);
        if (
            !verifyDocument(DOMAIN.grant, grant, this.options.platformPublicKey)
        )
            throw new BuyerError(
                "UNAUTHORIZED",
                "Platform authorization signature is invalid",
            );
        const value = grant.payload;
        const now = this.clock().getTime();
        if (
            Date.parse(value.issuedAt) > now + 5000 ||
            Date.parse(value.expiresAt) <= now
        )
            throw new BuyerError(
                "QUOTE_EXPIRED",
                "Private authorization expired",
            );
        for (const field of [
            "quoteId",
            "requestId",
            "buyerId",
            "sessionId",
            "buyerKeyId",
            "providerId",
            "providerKeyId",
            "startupId",
            "modelDigest",
            "priceVersion",
            "totalAtomic",
            "providerAtomic",
            "feeAtomic",
            "currency",
            "payloadDigest",
            "failurePolicy",
            "cancellationPolicy",
        ] as const)
            if (value[field] !== quote[field])
                throw new BuyerError(
                    "CONFLICT",
                    "Authorization does not match the accepted quote",
                );
        if (
            digest(value.limits) !== digest(quote.limits) ||
            keyId(value.providerPublicKeyPem) !== quote.providerKeyId ||
            keyId(value.buyerPublicKeyPem) !== this.buyerKeyId
        )
            throw new BuyerError(
                "CONFLICT",
                "Authorization identity or request limits changed",
            );
        if (operation && !value.operations.includes(operation))
            throw new BuyerError(
                "UNAUTHORIZED",
                "Private authorization does not permit this operation",
            );
        if (
            operation === "run_inference" &&
            Date.parse(value.executeBefore) <= now
        )
            throw new BuyerError(
                "QUOTE_EXPIRED",
                "Inference execution authorization expired; retrieve or cancel the request",
            );
        return value;
    }
    async purchase(input: {
        quoteId: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        z.uuid().parse(input.quoteId);
        z.uuid().parse(input.idempotencyKey);
        return this.mutex.run(async () => {
            const state = this.options.store.load();
            const record = Object.values(state.requests).find(
                (row) => row.quote?.quoteId === input.quoteId,
            );
            if (!record?.quote)
                throw new BuyerError(
                    "NOT_FOUND",
                    "Quote is not owned by this buyer facade",
                );
            if (record.sessionId !== this.options.owner.sessionId)
                throw new BuyerError(
                    "UNAUTHORIZED",
                    "Owner session changed; obtain a new quote",
                );
            if (
                record.idempotencyKey !== null &&
                record.idempotencyKey !== input.idempotencyKey
            )
                throw new BuyerError(
                    "CONFLICT",
                    "Reuse this quote's original purchase idempotency key",
                );
            if (record.purchaseState === "purchased")
                return {
                    requestId: record.requestId,
                    status: "purchased",
                    ...publicQuote(record.quote),
                };
            if (
                record.purchaseState === "quoted" &&
                Date.parse(record.quote.expiresAt) <= this.clock().getTime()
            )
                throw new BuyerError(
                    "QUOTE_EXPIRED",
                    "Quote expired; obtain a new quote",
                );
            this.enforceBudget(state, record, record.quote);
            record.idempotencyKey = input.idempotencyKey;
            record.purchaseState = "purchasing";
            this.options.store.save(state);
            try {
                const purchase = purchaseSchema.parse(
                    await this.options.cloud.purchase(input),
                );
                if (digest(purchase.quote) !== digest(record.quote))
                    throw new BuyerError(
                        "CONFLICT",
                        "Purchased quote differs from the accepted fixed quote",
                    );
                this.checkGrant(purchase.signedGrant, record.quote);
                if (
                    !purchase.signedGrant.payload.operations.includes(
                        "run_inference",
                    )
                )
                    throw new BuyerError(
                        "CONFLICT",
                        "Purchase did not return execution authority",
                    );
                record.signedGrant = purchase.signedGrant;
                record.descriptor = validateDescriptor(
                    purchase.descriptor,
                    record.quote,
                );
                record.purchaseState = "purchased";
                this.options.store.save(state);
                return {
                    requestId: record.requestId,
                    status: "purchased",
                    ...publicQuote(record.quote),
                };
            } catch (error) {
                // Even typed infrastructure failures may follow a committed purchase. Keep the hold.
                record.purchaseState = "uncertain";
                this.options.store.save(state);
                throw error;
            }
        });
    }
    private async invoke(
        record: StoredRequest,
        grant: SignedDocument<Grant>,
        descriptor: NonNullable<StoredRequest["descriptor"]>,
        operation: HostOperation,
    ) {
        if (!record.quote)
            throw new BuyerError("CONFLICT", "Request has no accepted quote");
        this.checkGrant(grant, record.quote, operation);
        const payload = operation === "run_inference" ? record.payload : {};
        const now = this.clock();
        const proof = signDocument(
            DOMAIN.operation,
            operationSchema.parse({
                version: 1,
                grantId: grant.payload.grantId,
                requestId: record.requestId,
                operation,
                nonce: randomUUID(),
                payloadDigest: digest(payload),
                issuedAt: now.toISOString(),
                expiresAt: new Date(
                    Math.min(
                        now.getTime() + 120000,
                        Date.parse(grant.payload.expiresAt),
                    ),
                ).toISOString(),
            }),
            this.options.privateKey,
        );
        assertFresh(proof.payload, now.getTime());
        const signed = providerResultSchema.parse(
            await this.options.peer.call(
                descriptor,
                { proof, grant, payload },
                Math.min(120000, grant.payload.limits.timeoutMs + 10000),
            ),
        );
        const response = signed.proof.payload;
        if (
            !verifyDocument(
                DOMAIN.response,
                signed.proof,
                record.quote.providerPublicKeyPem,
            ) ||
            response.providerId !== record.providerId ||
            response.startupId !== grant.payload.startupId ||
            response.requestId !== record.requestId ||
            response.operation !== operation ||
            response.nonce !== proof.payload.nonce ||
            response.resultDigest !== digest(signed.body) ||
            Date.parse(response.issuedAt) < now.getTime() - 5000 ||
            Date.parse(response.issuedAt) > this.clock().getTime() + 5000
        )
            throw new BuyerError(
                "UNAUTHORIZED",
                "Provider response identity or request binding is invalid",
            );
        const body = providerBodySchema.parse(signed.body);
        if (body.requestId !== record.requestId)
            throw new BuyerError(
                "CONFLICT",
                "Provider returned another request",
            );
        if (
            body.result &&
            body.result.outputTokens > record.payload.maxOutputTokens
        )
            throw new BuyerError(
                "CONFLICT",
                "Provider exceeded accepted output limits",
            );
        return body;
    }
    async run(input: { requestId: string }): Promise<Record<string, unknown>> {
        z.uuid().parse(input.requestId);
        const record = await this.update((state) => {
            const request = this.record(state, input.requestId);
            if (
                request.purchaseState !== "purchased" ||
                !request.quote ||
                !request.signedGrant ||
                !request.descriptor
            )
                throw new BuyerError(
                    "CONFLICT",
                    "Request has no completed purchase; reconcile purchase with its original key",
                );
            if (request.runState !== "not_sent")
                throw new BuyerError(
                    "UNCERTAIN",
                    "This request was already dispatched; use get_request instead of replaying inference",
                );
            this.checkGrant(
                request.signedGrant,
                request.quote,
                "run_inference",
            );
            request.runState = "dispatched";
            return request;
        });
        try {
            const body = await this.invoke(
                record,
                record.signedGrant!,
                record.descriptor!,
                "run_inference",
            );
            if (body.status === "completed")
                await this.update((state) => {
                    this.record(state, record.requestId).runState = "completed";
                });
            return {
                requestId: record.requestId,
                status: body.status,
                result: body.result ?? null,
                fixedTotalAtomic: record.quote!.totalAtomic,
                currency: "TEST_CREDIT",
                chargeAtomic: null,
                receipt: null,
                accounting: "pending_reconciliation",
                finishReason: body.status,
            };
        } catch (error) {
            await this.update((state) => {
                this.record(state, record.requestId).runState = "uncertain";
            });
            throw error;
        }
    }
    private async refresh(record: StoredRequest) {
        const cloud = cloudStateSchema.parse(
            await this.options.cloud.get(record.requestId),
        );
        if (cloud.requestId !== record.requestId)
            throw new BuyerError("CONFLICT", "Cloud returned another request");
        if (cloud.receipt) {
            const receipt = cloud.receipt;
            if (!record.quote || receipt.requestId !== record.requestId)
                throw new BuyerError(
                    "CONFLICT",
                    "Receipt does not match the owned request",
                );
            const debit = BigInt(receipt.buyerDebitAtomic);
            if (
                (receipt.status === "completed" &&
                    (receipt.buyerDebitAtomic !== record.quote.totalAtomic ||
                        receipt.providerEarningsAtomic !==
                            record.quote.providerAtomic ||
                        receipt.feeAtomic !== record.quote.feeAtomic ||
                        debit !==
                            BigInt(receipt.providerEarningsAtomic) +
                                BigInt(receipt.feeAtomic))) ||
                (receipt.status !== "completed" &&
                    (debit !== 0n ||
                        receipt.providerEarningsAtomic !== "0" ||
                        receipt.feeAtomic !== "0")) ||
                cloud.status !== receipt.status
            )
                throw new BuyerError(
                    "CONFLICT",
                    "Receipt violates fixed-price accounting",
                );
            await this.update((state) => {
                const request = this.record(state, record.requestId);
                request.reservedAtomic = "0";
                request.spentAtomic = receipt.buyerDebitAtomic;
            });
        }
        return cloud;
    }
    async get(input: { requestId: string }): Promise<Record<string, unknown>> {
        return this.retrieve(input.requestId, "get_request");
    }
    async cancel(input: {
        requestId: string;
    }): Promise<Record<string, unknown>> {
        return this.retrieve(input.requestId, "cancel_request");
    }
    private async retrieve(
        requestId: string,
        operation: "get_request" | "cancel_request",
    ): Promise<Record<string, unknown>> {
        z.uuid().parse(requestId);
        const record = this.record(this.options.store.load(), requestId);
        if (!record.quote || record.idempotencyKey === null)
            throw new BuyerError(
                "CONFLICT",
                "Request has no owned purchase attempt to retrieve",
            );
        if (operation === "cancel_request")
            await this.options.cloud.cancel(requestId);
        const cloud = await this.refresh(record);
        let result: unknown = null;
        let providerStatus: string | null = null;
        if (cloud.signedGrant && cloud.descriptor) {
            const descriptor = validateDescriptor(
                cloud.descriptor,
                record.quote,
                true,
            );
            try {
                const body = await this.invoke(
                    record,
                    cloud.signedGrant,
                    descriptor,
                    operation,
                );
                if (
                    cloud.receipt?.resultDigest &&
                    body.result &&
                    digest(body.result) !== cloud.receipt.resultDigest
                )
                    throw new BuyerError(
                        "UNAUTHORIZED",
                        "Retrieved result differs from the settled receipt",
                    );
                result = body.result ?? null;
                providerStatus = body.status;
                if (body.status === "completed")
                    await this.update((state) => {
                        this.record(state, record.requestId).runState =
                            "completed";
                    });
            } catch (error) {
                if (
                    !cloud.receipt ||
                    (error instanceof BuyerError &&
                        error.code === "UNAUTHORIZED")
                )
                    throw error;
                return {
                    requestId,
                    status: cloud.status,
                    result: null,
                    receipt: cloud.receipt,
                    chargeAtomic: cloud.receipt.buyerDebitAtomic,
                    providerStatus: "unavailable",
                    retrieval: "provider_unavailable",
                    currency: "TEST_CREDIT",
                };
            }
        }
        return {
            requestId,
            status: cloud.status,
            providerStatus,
            result,
            receipt: cloud.receipt,
            chargeAtomic: cloud.receipt?.buyerDebitAtomic ?? null,
            fixedTotalAtomic: record.quote.totalAtomic,
            currency: "TEST_CREDIT",
            cancelRequested: cloud.cancelRequested ?? false,
            finishReason: providerStatus ?? cloud.status,
        };
    }
}
