import { randomUUID, type KeyLike } from "node:crypto";
import {
    DOMAIN,
    cloudRequestSchema,
    digest,
    signDocument,
    type SignedDocument,
    type TerminalEvent,
    type Grant,
} from "@panas/protocol";

export interface AccountingPort {
    authorize(grant: Grant, signal: AbortSignal): Promise<void>;
    terminal(event: SignedDocument<TerminalEvent>): Promise<void>;
    descriptor(body: Record<string, unknown>): Promise<void>;
}
export class AccountingHttpClient implements AccountingPort {
    readonly base: URL;
    constructor(
        baseUrl: string,
        readonly providerId: string,
        readonly privateKey: KeyLike,
    ) {
        this.base = new URL(baseUrl);
        if (
            this.base.protocol !== "https:" &&
            !(
                this.base.protocol === "http:" &&
                ["127.0.0.1", "localhost"].includes(this.base.hostname)
            )
        )
            throw new Error(
                "Accounting requires HTTPS or explicit local development loopback",
            );
        if (
            this.base.username ||
            this.base.password ||
            this.base.search ||
            this.base.hash
        )
            throw new Error("Invalid accounting URL");
    }
    async post(
        path: string,
        body: unknown,
        signal = AbortSignal.timeout(10000),
    ): Promise<unknown> {
        const now = Date.now();
        const proof = signDocument(
            DOMAIN.cloud,
            cloudRequestSchema.parse({
                version: 1,
                actor: "provider",
                actorId: this.providerId,
                method: "POST",
                path,
                bodyDigest: digest(body),
                nonce: randomUUID(),
                issuedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + 60000).toISOString(),
            }),
            this.privateKey,
        );
        const response = await fetch(new URL(path, this.base), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-panas-proof": Buffer.from(JSON.stringify(proof)).toString(
                    "base64url",
                ),
            },
            body: JSON.stringify(body),
            signal,
            redirect: "error",
        });
        if (!response.ok) throw new Error("ACCOUNTING_REJECTED");
        return await response.json();
    }
    async authorize(grant: Grant, signal: AbortSignal): Promise<void> {
        const result = await this.post(
            `/provider/requests/${grant.requestId}/authorize`,
            {
                reservationId: grant.reservationId,
                grantId: grant.grantId,
                operation: "run_inference",
                payloadDigest: grant.payloadDigest,
            },
            signal,
        );
        if (
            !result ||
            typeof result !== "object" ||
            !("authorized" in result) ||
            result.authorized !== true ||
            !("requestId" in result) ||
            result.requestId !== grant.requestId ||
            !("reservationId" in result) ||
            result.reservationId !== grant.reservationId
        )
            throw new Error("ACCOUNTING_NOT_AUTHORIZED");
    }
    async terminal(event: SignedDocument<TerminalEvent>): Promise<void> {
        const result = await this.post(
            `/provider/requests/${event.payload.requestId}/terminal`,
            { event },
        );
        if (
            !result ||
            typeof result !== "object" ||
            !("requestId" in result) ||
            result.requestId !== event.payload.requestId ||
            !("status" in result) ||
            ![
                "completed",
                "cancelled",
                "failed",
                "pending",
                "refunded",
            ].includes(String(result.status)) ||
            !("receipt" in result)
        )
            throw new Error("TERMINAL_NOT_ACKNOWLEDGED");
        if (result.status === "pending") {
            if (event.payload.outcome !== "unknown" || result.receipt !== null)
                throw new Error("TERMINAL_NOT_ACKNOWLEDGED");
        } else {
            const receipt = result.receipt;
            if (
                !receipt ||
                typeof receipt !== "object" ||
                !("requestId" in receipt) ||
                receipt.requestId !== event.payload.requestId ||
                !("status" in receipt) ||
                receipt.status !== result.status ||
                !("currency" in receipt) ||
                receipt.currency !== "TEST_CREDIT"
            )
                throw new Error("TERMINAL_NOT_ACKNOWLEDGED");
            if (
                event.payload.outcome !== "unknown" &&
                result.status !== event.payload.outcome &&
                result.status !== "refunded"
            )
                throw new Error("TERMINAL_NOT_ACKNOWLEDGED");
        }
    }
    async descriptor(body: Record<string, unknown>): Promise<void> {
        const result = await this.post("/provider/descriptor", body);
        if (
            !result ||
            typeof result !== "object" ||
            !("uploaded" in result) ||
            result.uploaded !== true ||
            !("providerId" in result) ||
            result.providerId !== this.providerId ||
            !("startupId" in result) ||
            result.startupId !== body.startupId
        )
            throw new Error("DESCRIPTOR_NOT_ACKNOWLEDGED");
    }
}
