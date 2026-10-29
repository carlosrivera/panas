import { randomUUID, type KeyLike } from "node:crypto";
import {
    DOMAIN,
    assertFresh,
    digest,
    emptyPayloadSchema,
    inferencePayloadSchema,
    keyId,
    signDocument,
    terminalEventSchema,
    verifyDocument,
    wireRequestSchema,
    type Grant,
    type HostOperation,
    type SignedDocument,
    type TerminalEvent,
    providerResponseSchema,
} from "@panas/protocol";
import {
    EncryptedStore,
    ProviderDaemon,
    ProviderError,
    type RequestHooks,
    type StoredRequest,
} from "@panas/provider";
import type { AccountingPort } from "./accounting-client.js";

export interface HostIdentity {
    providerId: string;
    providerPrivateKey: KeyLike;
    platformPublicKey: KeyLike;
}
export class ProviderHostService {
    private operations: Promise<unknown> = Promise.resolve();
    private flushing: Promise<void> | undefined;
    private terminalCursor: string | undefined;
    daemon: ProviderDaemon | undefined;
    constructor(
        readonly identity: HostIdentity,
        readonly nonces: EncryptedStore,
        readonly accounting: AccountingPort,
        readonly now = () => Date.now(),
    ) {}
    bind(daemon: ProviderDaemon): void {
        this.daemon = daemon;
    }
    private get worker(): ProviderDaemon {
        if (!this.daemon) throw new ProviderError("HOST_UNAVAILABLE");
        return this.daemon;
    }
    private grantFrom(record: StoredRequest): Grant {
        return wireRequestSchema.shape.grant.parse(record.authorization)
            .payload;
    }
    readonly hooks: RequestHooks = {
        timeoutMs: (record) => this.grantFrom(record).limits.timeoutMs,
        beforeExecute: async (record, _request, signal) => {
            const grant = this.grantFrom(record);
            if (
                grant.startupId !== this.worker.report?.startupId ||
                Date.parse(grant.executeBefore) <= this.now() ||
                Date.parse(grant.expiresAt) <= this.now()
            )
                throw new ProviderError("EXECUTION_GRANT_EXPIRED");
            await this.accounting.authorize(grant, signal);
            if (Date.parse(grant.executeBefore) <= this.now())
                throw new ProviderError("EXECUTION_GRANT_EXPIRED");
        },
        terminalEvent: (record) => {
            const grant = this.grantFrom(record);
            if (record.status === "running")
                throw new ProviderError("TERMINAL_STATE_REQUIRED");
            const result = record.result;
            const event = terminalEventSchema.parse({
                version: 1,
                eventId: randomUUID(),
                grantId: grant.grantId,
                reservationId: grant.reservationId,
                requestId: record.requestId,
                providerId: grant.providerId,
                startupId: grant.startupId,
                outcome: record.status,
                resultDigest: result ? digest(result) : null,
                completedAt: new Date(record.updatedAt).toISOString(),
                usage: result
                    ? {
                          inputTokens: result.inputTokens,
                          outputTokens: result.outputTokens,
                          durationMs: result.durationMs,
                      }
                    : null,
            });
            return signDocument(
                DOMAIN.terminal,
                event,
                this.identity.providerPrivateKey,
            );
        },
    };
    async init(): Promise<void> {
        await this.nonces.init();
        await this.nonces.recoverAndCleanup();
        await this.worker.recoverTerminalEvents();
    }
    private async consumeNonce(
        nonce: string,
        buyerKeyId: string,
        fingerprint: string,
    ): Promise<void> {
        if (await this.nonces.get(nonce))
            throw new ProviderError("REPLAYED_OPERATION");
        await this.nonces.save({
            requestId: nonce,
            buyerKeyId,
            fingerprint,
            status: "completed",
            updatedAt: this.now(),
        });
    }
    async handle(input: unknown): Promise<unknown> {
        const action = async () => this.execute(input);
        const pending = this.operations.then(action);
        this.operations = pending.catch(() => {});
        return pending;
    }
    private async execute(input: unknown): Promise<unknown> {
        if (
            !input ||
            typeof input !== "object" ||
            !("tool" in input) ||
            !("request" in input)
        )
            throw new ProviderError("INVALID_OPERATION");
        const { tool } = input;
        if (
            !["run_inference", "get_request", "cancel_request"].includes(
                String(tool),
            )
        )
            throw new ProviderError("INVALID_OPERATION");
        const wire = wireRequestSchema.parse(input.request),
            grant = wire.grant.payload,
            proof = wire.proof.payload;
        if (
            !verifyDocument(
                DOMAIN.grant,
                wire.grant,
                this.identity.platformPublicKey,
            )
        )
            throw new ProviderError("INVALID_PLATFORM_GRANT");
        assertFresh(grant, this.now(), 86400000);
        assertFresh(proof, this.now());
        if (
            grant.providerId !== this.identity.providerId ||
            grant.providerKeyId !== keyId(this.identity.providerPrivateKey) ||
            keyId(grant.providerPublicKeyPem) !== grant.providerKeyId ||
            keyId(grant.buyerPublicKeyPem) !== grant.buyerKeyId ||
            !verifyDocument(
                DOMAIN.operation,
                wire.proof,
                grant.buyerPublicKeyPem,
            ) ||
            wire.proof.keyId !== grant.buyerKeyId
        )
            throw new ProviderError("IDENTITY_MISMATCH");
        if (
            proof.operation !== tool ||
            !grant.operations.includes(proof.operation) ||
            proof.grantId !== grant.grantId ||
            proof.requestId !== grant.requestId ||
            proof.payloadDigest !== digest(wire.payload)
        )
            throw new ProviderError("OPERATION_BINDING_MISMATCH");
        const operation = tool as HostOperation;
        const existing = await this.worker.get(
            grant.requestId,
            grant.buyerKeyId,
        );
        if (operation !== "run_inference") {
            emptyPayloadSchema.parse(wire.payload);
            if (!existing?.authorization)
                throw new ProviderError("REQUEST_NOT_FOUND");
            const original = this.grantFrom(existing);
            if (
                original.reservationId !== grant.reservationId ||
                original.quoteId !== grant.quoteId ||
                original.startupId !== grant.startupId ||
                original.modelDigest !== grant.modelDigest ||
                original.buyerId !== grant.buyerId
            )
                throw new ProviderError("REQUEST_BINDING_MISMATCH");
        }
        let record: StoredRequest | undefined;
        if (operation === "run_inference") {
            const payload = inferencePayloadSchema.parse(wire.payload);
            if (
                grant.startupId !== this.worker.report?.startupId ||
                grant.modelDigest !== this.worker.report?.model.digest ||
                Date.parse(grant.executeBefore) <= this.now() ||
                proof.payloadDigest !== grant.payloadDigest
            )
                throw new ProviderError("EXECUTION_BINDING_MISMATCH");
            await this.consumeNonce(
                proof.nonce,
                grant.buyerKeyId,
                digest(wire),
            );
            const request = {
                requestId: grant.requestId,
                quoteId: grant.quoteId,
                ...payload,
            };
            try {
                if (
                    payload.maxOutputTokens > grant.limits.maxOutputTokens ||
                    Buffer.byteLength(payload.prompt) >
                        grant.limits.maxContextTokens -
                            payload.maxOutputTokens -
                            16
                )
                    throw new ProviderError("GRANT_LIMIT_EXCEEDED");
                record = await this.worker.submit(
                    request,
                    grant.buyerKeyId,
                    wire.grant,
                );
            } catch (error) {
                if (
                    error instanceof ProviderError &&
                    [
                        "QUEUE_FULL",
                        "RATE_LIMITED",
                        "PROVIDER_UNAVAILABLE",
                        "CONTEXT_TOO_LARGE",
                        "GRANT_LIMIT_EXCEEDED",
                    ].includes(error.code)
                ) {
                    await this.worker.declineAuthenticated(
                        request,
                        grant.buyerKeyId,
                        wire.grant,
                        error.code,
                    );
                }
                throw error;
            }
        } else {
            await this.consumeNonce(
                proof.nonce,
                grant.buyerKeyId,
                digest(wire),
            );
            record =
                operation === "cancel_request"
                    ? await this.worker.cancel(
                          grant.requestId,
                          grant.buyerKeyId,
                      )
                    : existing;
        }
        const body = record
            ? {
                  requestId: record.requestId,
                  status: record.status,
                  ...(record.result ? { result: record.result } : {}),
                  ...(record.error ? { error: record.error } : {}),
                  updatedAt: new Date(record.updatedAt).toISOString(),
              }
            : null;
        const response = signDocument(
            DOMAIN.response,
            providerResponseSchema.parse({
                version: 1,
                providerId: this.identity.providerId,
                startupId: grant.startupId,
                requestId: grant.requestId,
                operation,
                nonce: proof.nonce,
                resultDigest: digest(body),
                issuedAt: new Date(this.now()).toISOString(),
            }),
            this.identity.providerPrivateKey,
        );
        return { body, proof: response };
    }
    async flushTerminals(): Promise<void> {
        if (this.flushing) return this.flushing;
        this.flushing = this.deliverTerminals();
        try {
            await this.flushing;
        } finally {
            this.flushing = undefined;
        }
    }
    private async deliverTerminals(): Promise<void> {
        const pending = (await this.worker.pendingTerminals()).sort((a, b) =>
            a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0,
        );
        const after = pending.filter(
            (r) => !this.terminalCursor || r.requestId > this.terminalCursor,
        );
        const before = pending.filter(
            (r) => this.terminalCursor && r.requestId <= this.terminalCursor,
        );
        const budget = AbortSignal.timeout(10000);
        let failed = false;
        for (const record of [...after, ...before].slice(0, 16)) {
            if (budget.aborted) {
                failed = true;
                break;
            }
            this.terminalCursor = record.requestId;
            try {
                await this.accounting.terminal(
                    record.terminalEvent as SignedDocument<TerminalEvent>,
                    budget,
                );
                await this.worker.acknowledgeTerminal(record.requestId);
            } catch {
                failed = true; // One rejected/uncertain acknowledgement must not starve other records.
            }
        }
        if (failed) throw new Error("TERMINAL_DELIVERY_UNAVAILABLE");
    }
}
