import { createPublicKey, randomUUID, type KeyLike } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { z } from "zod";
import { capabilityReportSchema } from "@panas/contracts/provider";
import { registryPriceSchema } from "@panas/contracts/registry";
import { atomicAmountSchema } from "@panas/contracts";
import {
    assertFresh,
    DOMAIN,
    digest,
    keyId,
    quoteSchema,
    grantSchema,
    signedGrantSchema,
    signedCloudRequestSchema,
    verifyDocument,
    signDocument,
    type Quote,
    type Grant,
    type SignedDocument,
} from "@panas/protocol";
import { readiness, type StoredProvider } from "@panas/registry";
import { encryptDescriptor, decryptDescriptor } from "./crypto.js";
import {
    AccountingError,
    quoteInputSchema,
    purchaseInputSchema,
    authorizeInputSchema,
    terminalInputSchema,
    descriptorInputSchema,
    descriptorSchema,
    receiptSchema,
    type Receipt,
    type Descriptor,
    type RequestStatus,
} from "./types.js";

interface Actor {
    actor: "buyer" | "provider";
    id: string;
    publicKeyPem: string;
    keyId: string;
    nonce: string;
    expiresAt: string;
    issuedAt: string;
}
interface Buyer {
    buyer_id: string;
    public_key_pem: string;
    enabled: boolean;
    balance: string;
    held: string;
    max_request: string;
    max_session: string;
    max_daily: string;
    policy_version: string;
}
interface Session {
    session_id: string;
    buyer_id: string;
    cap: string;
    held: string;
    spent: string;
    enabled: boolean;
    expires_at: Date;
}
interface StoredRequest {
    request_id: string;
    reservation_id: string;
    buyer_id: string;
    session_id: string;
    quote_id: string;
    idempotency_key: string;
    signed_grant: unknown;
    status: RequestStatus;
    cancel_requested: boolean;
    authorized_at: Date | null;
    terminal_event_id: string | null;
    receipt: unknown;
    usage_day: string;
    policy_version: string;
    reconcile_after: Date;
    created_at: Date;
}
const REQUEST_COLUMNS =
    "request_id,reservation_id,buyer_id,session_id,quote_id,idempotency_key,signed_grant,status,cancel_requested,authorized_at,terminal_event_id,receipt,usage_day::text,policy_version,reconcile_after,created_at";
const terminalStatuses = new Set<RequestStatus>([
    "completed",
    "failed",
    "cancelled",
    "refunded",
]);
function fail(
    code: ConstructorParameters<typeof AccountingError>[0],
    status: number,
    message: string,
): never {
    throw new AccountingError(code, status, message);
}
function rowDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
}
function grantOf(row: StoredRequest): SignedDocument<Grant> {
    return signedGrantSchema.parse(row.signed_grant);
}
function positive(value: string): bigint {
    atomicAmountSchema.parse(value);
    return BigInt(value);
}
export interface AccountingOptions {
    platformPrivateKey: KeyLike;
    descriptorEncryptionKey: Buffer;
    feeAtomic?: string;
    clock?: () => Date;
}
export class AccountingService {
    private readonly now: () => Date;
    private readonly fee: bigint;
    constructor(
        private readonly pool: pg.Pool,
        private readonly options: AccountingOptions,
    ) {
        this.now = options.clock ?? (() => new Date());
        this.fee = positive(options.feeAtomic ?? "0");
        if (options.descriptorEncryptionKey.length !== 32)
            throw new Error("Configure descriptor encryption");
        keyId(options.platformPrivateKey);
    }
    async authenticate(
        document: unknown,
        method: string,
        path: string,
        body: unknown,
    ): Promise<Actor> {
        const proof = signedCloudRequestSchema.parse(document);
        const p = proof.payload;
        if (
            p.method !== method ||
            p.path !== path ||
            p.bodyDigest !== digest(body)
        )
            fail("UNAUTHORIZED", 401, "Signed cloud target does not match");
        try {
            assertFresh(p, this.now().getTime(), 120000);
        } catch {
            fail("UNAUTHORIZED", 401, "Signed cloud request expired");
        }
        const table =
            p.actor === "buyer"
                ? "panas_accounting_buyers"
                : "panas_provider_keys";
        const column = p.actor === "buyer" ? "buyer_id" : "provider_id";
        const row = (
            await this.pool.query(
                `SELECT public_key_pem,enabled FROM ${table} WHERE ${column}=$1`,
                [p.actorId],
            )
        ).rows[0] as { public_key_pem: string; enabled: boolean } | undefined;
        if (
            !row?.enabled ||
            !verifyDocument(DOMAIN.cloud, proof, row.public_key_pem)
        )
            fail("UNAUTHORIZED", 401, "Actor is not authorized");
        return {
            actor: p.actor,
            id: p.actorId,
            publicKeyPem: row.public_key_pem,
            keyId: proof.keyId,
            nonce: p.nonce,
            expiresAt: p.expiresAt,
            issuedAt: p.issuedAt,
        };
    }
    private async tx<T>(
        actor: Actor,
        buyerId: string | null,
        task: (client: PoolClient, buyer: Buyer | null) => Promise<T>,
    ): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            let buyer: Buyer | null = null;
            if (buyerId) {
                buyer =
                    ((
                        await client.query(
                            "SELECT buyer_id,public_key_pem,enabled,balance::text,held::text,max_request::text,max_session::text,max_daily::text,policy_version FROM panas_accounting_buyers WHERE buyer_id=$1 FOR UPDATE",
                            [buyerId],
                        )
                    ).rows[0] as Buyer | undefined) ?? null;
                if (!buyer) fail("NOT_FOUND", 404, "Buyer account not found");
            }
            if (actor.actor === "buyer") {
                if (
                    !buyer ||
                    buyer.buyer_id !== actor.id ||
                    !buyer.enabled ||
                    buyer.public_key_pem !== actor.publicKeyPem
                )
                    fail("UNAUTHORIZED", 401, "Buyer authorization changed");
            } else {
                const key = (
                    await client.query(
                        "SELECT public_key_pem,enabled FROM panas_provider_keys WHERE provider_id=$1 FOR SHARE",
                        [actor.id],
                    )
                ).rows[0] as
                    { public_key_pem: string; enabled: boolean } | undefined;
                if (!key?.enabled || key.public_key_pem !== actor.publicKeyPem)
                    fail("UNAUTHORIZED", 401, "Provider authorization changed");
            }
            try {
                assertFresh(actor, this.now().getTime(), 120000);
            } catch {
                fail(
                    "UNAUTHORIZED",
                    401,
                    "Cloud authorization expired while waiting",
                );
            }
            await client.query(
                "DELETE FROM panas_accounting_nonces WHERE actor=$1 AND actor_id=$2 AND expires_at<=$3",
                [actor.actor, actor.id, this.now()],
            );
            const inserted = await client.query(
                "INSERT INTO panas_accounting_nonces(actor,actor_id,nonce,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING nonce",
                [actor.actor, actor.id, actor.nonce, actor.expiresAt],
            );
            if (inserted.rowCount !== 1)
                fail(
                    "REPLAYED_REQUEST",
                    409,
                    "Cloud authorization nonce already used",
                );
            const result = await task(client, buyer);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* Preserve original operation failure. */
            }
            throw error;
        } finally {
            client.release();
        }
    }
    private async registryProvider(
        client: PoolClient,
        id: string,
        allowBusy = false,
    ): Promise<{ provider: StoredProvider; publicKeyPem: string }> {
        const enabledKey = (
            await client.query(
                "SELECT public_key_pem FROM panas_provider_keys WHERE provider_id=$1 AND enabled=true FOR SHARE",
                [id],
            )
        ).rows[0];
        if (!enabledKey)
            fail(
                "PROVIDER_UNAVAILABLE",
                409,
                "Provider enrollment unavailable",
            );
        const row = (
            await client.query(
                "SELECT p.provider_id,p.report,p.price,p.report_digest,p.sequence,p.state,p.received_at,p.created_at,p.eligible,p.retired_at,k.public_key_pem FROM panas_registry_current p JOIN panas_provider_keys k USING(provider_id) WHERE p.provider_id=$1 AND k.enabled=true",
                [id],
            )
        ).rows[0] as Record<string, unknown> | undefined;
        if (!row)
            fail("PROVIDER_UNAVAILABLE", 409, "Provider is not available");
        const provider: StoredProvider = {
            providerId: id,
            report: capabilityReportSchema.parse(row.report),
            price: registryPriceSchema.parse(row.price),
            reportDigest: String(row.report_digest),
            sequence: Number(row.sequence),
            state: String(row.state) as StoredProvider["state"],
            receivedAt: rowDate(row.received_at as Date),
            createdAt: rowDate(row.created_at as Date),
            eligible: row.eligible === true,
            retiredAt: row.retired_at ? rowDate(row.retired_at as Date) : null,
        };
        if (
            !readiness(
                allowBusy && provider.state === "busy"
                    ? { ...provider, state: "ready" }
                    : provider,
                this.now(),
            ).ready
        )
            fail(
                "PROVIDER_UNAVAILABLE",
                409,
                "Provider evidence or heartbeat is not ready",
            );
        return { provider, publicKeyPem: String(row.public_key_pem) };
    }
    private async session(
        client: PoolClient,
        buyer: Buyer,
        id: string,
        amount?: bigint,
    ) {
        const session = (
            await client.query(
                "SELECT session_id,buyer_id,cap::text,held::text,spent::text,enabled,expires_at FROM panas_accounting_sessions WHERE session_id=$1 AND buyer_id=$2 FOR UPDATE",
                [id, buyer.buyer_id],
            )
        ).rows[0] as Session | undefined;
        if (
            !session ||
            !session.enabled ||
            rowDate(session.expires_at).getTime() <= this.now().getTime()
        )
            fail("SPENDING_LIMIT", 402, "Owner session is unavailable");
        if (
            amount !== undefined &&
            (amount > BigInt(buyer.max_request) ||
                BigInt(session.held) + BigInt(session.spent) + amount >
                    BigInt(session.cap) ||
                BigInt(session.held) + BigInt(session.spent) + amount >
                    BigInt(buyer.max_session))
        )
            fail(
                "SPENDING_LIMIT",
                402,
                "Owner request or session limit exceeded",
            );
        return session;
    }
    async quote(actor: Actor, input: unknown): Promise<Quote> {
        if (actor.actor !== "buyer")
            fail("UNAUTHORIZED", 401, "Buyer authorization required");
        const body = quoteInputSchema.parse(input);
        return this.tx(actor, actor.id, async (client, buyer) => {
            const fingerprint = digest(body);
            const old = (
                await client.query(
                    "SELECT fingerprint,quote FROM panas_accounting_quotes WHERE buyer_id=$1 AND request_id=$2",
                    [actor.id, body.requestId],
                )
            ).rows[0] as { fingerprint: string; quote: unknown } | undefined;
            if (old) {
                if (old.fingerprint !== fingerprint)
                    fail(
                        "CONFLICT",
                        409,
                        "Request identifier already has different quote terms",
                    );
                const q = quoteSchema.parse(old.quote);
                if (Date.parse(q.expiresAt) <= this.now().getTime())
                    fail(
                        "QUOTE_EXPIRED",
                        409,
                        "Quote expired; use a new request identifier",
                    );
                return q;
            }
            const { provider, publicKeyPem } = await this.registryProvider(
                client,
                body.providerId,
            );
            await this.session(client, buyer!, body.sessionId);
            if (!provider.report.model.digest)
                fail("PROVIDER_UNAVAILABLE", 409, "Model revision is missing");
            if (body.maxOutputTokens > provider.report.profile.maxOutputTokens)
                fail(
                    "INVALID_INPUT",
                    400,
                    "Requested output exceeds provider profile",
                );
            const now = this.now(),
                providerAtomic = BigInt(provider.price.totalAtomic),
                total = providerAtomic + this.fee;
            const q = quoteSchema.parse({
                version: 1,
                quoteId: randomUUID(),
                requestId: body.requestId,
                buyerId: actor.id,
                sessionId: body.sessionId,
                buyerKeyId: actor.keyId,
                providerId: body.providerId,
                providerKeyId: keyId(publicKeyPem),
                providerPublicKeyPem: publicKeyPem,
                startupId: provider.report.startupId,
                modelDigest: provider.report.model.digest.replace(
                    /^sha256:/,
                    "",
                ),
                priceVersion: provider.price.version,
                totalAtomic: total.toString(),
                providerAtomic: providerAtomic.toString(),
                feeAtomic: this.fee.toString(),
                currency: "TEST_CREDIT",
                limits: {
                    ...provider.report.profile,
                    maxOutputTokens: body.maxOutputTokens,
                },
                payloadDigest: body.payloadDigest,
                failurePolicy: "no_charge_failed_or_cancelled",
                cancellationPolicy: "provider_terminal_decision",
                issuedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 120000).toISOString(),
            });
            await client.query(
                "INSERT INTO panas_accounting_quotes(quote_id,buyer_id,request_id,fingerprint,quote,created_at) VALUES($1,$2,$3,$4,$5,$6)",
                [q.quoteId, actor.id, q.requestId, fingerprint, q, now],
            );
            return q;
        });
    }
    private async descriptor(
        client: PoolClient,
        providerId: string,
        expectedKeyId: string,
        startupId?: string,
    ): Promise<Descriptor> {
        const row = (
            await client.query(
                "SELECT encrypted_descriptor,expires_at,startup_id,provider_key_id FROM panas_accounting_descriptors WHERE provider_id=$1",
                [providerId],
            )
        ).rows[0] as
            | {
                  encrypted_descriptor: string;
                  expires_at: Date;
                  startup_id: string;
                  provider_key_id: string;
              }
            | undefined;
        if (
            !row ||
            row.provider_key_id !== expectedKeyId ||
            (startupId && row.startup_id !== startupId) ||
            rowDate(row.expires_at).getTime() <= this.now().getTime() + 5000
        )
            fail(
                "PROVIDER_UNAVAILABLE",
                409,
                "Private provider connection is not available",
            );
        return decryptDescriptor(
            row.encrypted_descriptor,
            this.options.descriptorEncryptionKey,
        );
    }
    async purchase(actor: Actor, input: unknown) {
        if (actor.actor !== "buyer")
            fail("UNAUTHORIZED", 401, "Buyer authorization required");
        const body = purchaseInputSchema.parse(input);
        return this.tx(actor, actor.id, async (client, buyer) => {
            const existing = (
                await client.query(
                    `SELECT ${REQUEST_COLUMNS} FROM panas_accounting_requests WHERE buyer_id=$1 AND idempotency_key=$2`,
                    [actor.id, body.idempotencyKey],
                )
            ).rows[0] as StoredRequest | undefined;
            if (existing) {
                if (existing.quote_id !== body.quoteId)
                    fail(
                        "CONFLICT",
                        409,
                        "Purchase key already identifies another quote",
                    );
                const grant = grantOf(existing);
                return {
                    quote: quoteSchema.parse(
                        (
                            await client.query(
                                "SELECT quote FROM panas_accounting_quotes WHERE quote_id=$1",
                                [existing.quote_id],
                            )
                        ).rows[0].quote,
                    ),
                    signedGrant: grant,
                    descriptor: await this.descriptor(
                        client,
                        grant.payload.providerId,
                        grant.payload.providerKeyId,
                        grant.payload.startupId,
                    ),
                };
            }
            const qrow = (
                await client.query(
                    "SELECT quote FROM panas_accounting_quotes WHERE quote_id=$1 AND buyer_id=$2",
                    [body.quoteId, actor.id],
                )
            ).rows[0] as { quote: unknown } | undefined;
            if (!qrow) fail("NOT_FOUND", 404, "Quote not found");
            const q = quoteSchema.parse(qrow.quote);
            if (q.buyerKeyId !== actor.keyId)
                fail("UNAUTHORIZED", 401, "Quote buyer key changed");
            if (Date.parse(q.expiresAt) <= this.now().getTime())
                fail("QUOTE_EXPIRED", 409, "Quote expired");
            const prior = (
                await client.query(
                    "SELECT request_id FROM panas_accounting_requests WHERE request_id=$1 OR quote_id=$2",
                    [q.requestId, q.quoteId],
                )
            ).rows[0];
            if (prior) fail("CONFLICT", 409, "Request already purchased");
            const { provider, publicKeyPem } = await this.registryProvider(
                client,
                q.providerId,
            );
            if (
                provider.report.startupId !== q.startupId ||
                keyId(publicKeyPem) !== q.providerKeyId ||
                provider.report.model.digest?.replace(/^sha256:/, "") !==
                    q.modelDigest ||
                provider.price.version !== q.priceVersion ||
                provider.price.totalAtomic !== q.providerAtomic ||
                provider.report.profile.maxContextTokens <
                    q.limits.maxContextTokens ||
                provider.report.profile.maxOutputTokens <
                    q.limits.maxOutputTokens ||
                provider.report.profile.timeoutMs < q.limits.timeoutMs ||
                provider.report.profile.queueDepth < q.limits.queueDepth
            )
                fail(
                    "PROVIDER_UNAVAILABLE",
                    409,
                    "Provider terms changed before purchase",
                );
            const descriptor = await this.descriptor(
                client,
                q.providerId,
                q.providerKeyId,
                q.startupId,
            );
            const amount = BigInt(q.totalAtomic);
            await this.session(client, buyer!, q.sessionId, amount);
            if (BigInt(buyer!.balance) - BigInt(buyer!.held) < amount)
                fail(
                    "SPENDING_LIMIT",
                    402,
                    "Insufficient available test credits",
                );
            const now = this.now(),
                day = now.toISOString().slice(0, 10);
            await client.query(
                "INSERT INTO panas_accounting_daily(buyer_id,usage_day) VALUES($1,$2) ON CONFLICT DO NOTHING",
                [actor.id, day],
            );
            const daily = (
                await client.query(
                    "SELECT held::text,spent::text FROM panas_accounting_daily WHERE buyer_id=$1 AND usage_day=$2 FOR UPDATE",
                    [actor.id, day],
                )
            ).rows[0] as { held: string; spent: string };
            if (
                BigInt(daily.held) + BigInt(daily.spent) + amount >
                BigInt(buyer!.max_daily)
            )
                fail("SPENDING_LIMIT", 402, "Owner daily limit exceeded");
            const reservationId = randomUUID(),
                executeBefore = new Date(
                    Math.min(
                        now.getTime() + 120000,
                        Date.parse(descriptor.expiresAt) - 1000,
                    ),
                ).toISOString();
            const grant = grantSchema.parse({
                ...q,
                grantId: randomUUID(),
                reservationId,
                buyerPublicKeyPem: actor.publicKeyPem,
                operations: ["run_inference", "get_request", "cancel_request"],
                issuedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 86400000).toISOString(),
                executeBefore,
            });
            const signedGrant = signDocument(
                DOMAIN.grant,
                grant,
                this.options.platformPrivateKey,
            );
            await client.query(
                "UPDATE panas_accounting_buyers SET held=held+$2::numeric WHERE buyer_id=$1",
                [actor.id, q.totalAtomic],
            );
            await client.query(
                "UPDATE panas_accounting_sessions SET held=held+$2::numeric WHERE session_id=$1",
                [q.sessionId, q.totalAtomic],
            );
            await client.query(
                "UPDATE panas_accounting_daily SET held=held+$3::numeric WHERE buyer_id=$1 AND usage_day=$2",
                [actor.id, day, q.totalAtomic],
            );
            await client.query(
                "INSERT INTO panas_accounting_requests(request_id,reservation_id,buyer_id,session_id,quote_id,idempotency_key,signed_grant,status,usage_day,policy_version,reconcile_after,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                [
                    q.requestId,
                    reservationId,
                    actor.id,
                    q.sessionId,
                    q.quoteId,
                    body.idempotencyKey,
                    signedGrant,
                    "reserved",
                    day,
                    buyer!.policy_version,
                    new Date(now.getTime() + 600000),
                    now,
                ],
            );
            return { quote: q, signedGrant, descriptor };
        });
    }
    private async requestActor(
        actor: Actor,
        id: string,
        task: (
            client: PoolClient,
            row: StoredRequest,
            buyer: Buyer,
        ) => Promise<unknown>,
    ) {
        z.uuid().parse(id);
        const peek = (
            await this.pool.query(
                "SELECT buyer_id FROM panas_accounting_requests WHERE request_id=$1",
                [id],
            )
        ).rows[0] as { buyer_id: string } | undefined;
        if (!peek) fail("NOT_FOUND", 404, "Request not found");
        if (actor.actor === "buyer" && peek.buyer_id !== actor.id)
            fail("NOT_FOUND", 404, "Request not found");
        return this.tx(actor, peek.buyer_id, async (client, buyer) => {
            const row = (
                await client.query(
                    `SELECT ${REQUEST_COLUMNS} FROM panas_accounting_requests WHERE request_id=$1 FOR UPDATE`,
                    [id],
                )
            ).rows[0] as StoredRequest | undefined;
            if (!row) fail("NOT_FOUND", 404, "Request not found");
            const grant = grantOf(row);
            if (
                actor.actor === "provider" &&
                (grant.payload.providerId !== actor.id ||
                    grant.payload.providerKeyId !== actor.keyId)
            )
                fail("UNAUTHORIZED", 401, "Provider does not own request");
            return task(client, row, buyer!);
        });
    }
    async authorize(actor: Actor, id: string, input: unknown) {
        if (actor.actor !== "provider")
            fail("UNAUTHORIZED", 401, "Provider authorization required");
        const body = authorizeInputSchema.parse(input);
        return this.requestActor(actor, id, async (client, row, buyer) => {
            const grant = grantOf(row).payload;
            if (
                body.reservationId !== row.reservation_id ||
                body.grantId !== grant.grantId ||
                body.payloadDigest !== grant.payloadDigest
            )
                fail("UNAUTHORIZED", 401, "Execution binding does not match");
            if (
                row.cancel_requested ||
                terminalStatuses.has(row.status) ||
                row.status === "pending" ||
                Date.parse(grant.executeBefore) <= this.now().getTime()
            )
                fail("CONFLICT", 409, "Reservation cannot authorize execution");
            if (!row.authorized_at) {
                if (
                    !buyer.enabled ||
                    keyId(buyer.public_key_pem) !== grant.buyerKeyId
                )
                    fail("UNAUTHORIZED", 401, "Owner buyer authority changed");
                await this.session(client, buyer, grant.sessionId);
                if (BigInt(grant.totalAtomic) > BigInt(buyer.max_request))
                    fail(
                        "SPENDING_LIMIT",
                        402,
                        "Owner request limit was reduced",
                    );
            }
            const current = await this.registryProvider(
                client,
                grant.providerId,
                true,
            );
            if (
                current.provider.report.startupId !== grant.startupId ||
                current.provider.report.model.digest?.replace(
                    /^sha256:/,
                    "",
                ) !== grant.modelDigest ||
                keyId(current.publicKeyPem) !== grant.providerKeyId ||
                current.provider.report.profile.maxContextTokens <
                    grant.limits.maxContextTokens ||
                current.provider.report.profile.maxOutputTokens <
                    grant.limits.maxOutputTokens ||
                current.provider.report.profile.timeoutMs <
                    grant.limits.timeoutMs ||
                current.provider.report.profile.queueDepth <
                    grant.limits.queueDepth
            )
                fail(
                    "PROVIDER_UNAVAILABLE",
                    409,
                    "Provider startup/model changed",
                );
            if (row.status !== "reserved" && row.status !== "authorized")
                fail("CONFLICT", 409, "Invalid execution state");
            if (!row.authorized_at)
                await client.query(
                    "UPDATE panas_accounting_requests SET status='authorized',authorized_at=$2 WHERE request_id=$1",
                    [id, this.now()],
                );
            return {
                authorized: true,
                requestId: id,
                reservationId: row.reservation_id,
            };
        });
    }
    async uploadDescriptor(actor: Actor, input: unknown) {
        if (actor.actor !== "provider")
            fail("UNAUTHORIZED", 401, "Provider authorization required");
        const body = descriptorInputSchema.parse(input);
        return this.tx(actor, null, async (client) => {
            if (
                body.providerKeyId !== actor.keyId ||
                keyId(body.providerPublicKeyPem) !== actor.keyId
            )
                fail("UNAUTHORIZED", 401, "Descriptor provider key differs");
            const current = (
                await client.query(
                    "SELECT startup_id FROM panas_registry_current WHERE provider_id=$1",
                    [actor.id],
                )
            ).rows[0] as { startup_id: string } | undefined;
            if (current?.startup_id !== body.startupId)
                fail("CONFLICT", 409, "Descriptor startup is not registered");
            const now = this.now(),
                expires = Date.parse(body.expiresAt);
            if (
                expires <= now.getTime() + 5000 ||
                expires > now.getTime() + 3600000
            )
                fail(
                    "INVALID_INPUT",
                    400,
                    "Descriptor expiry must fit host session",
                );
            const descriptor = descriptorSchema.parse({
                providerId: actor.id,
                ...body,
            });
            await client.query(
                "INSERT INTO panas_accounting_descriptors(provider_id,startup_id,provider_key_id,encrypted_descriptor,expires_at,uploaded_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_id) DO UPDATE SET startup_id=EXCLUDED.startup_id,provider_key_id=EXCLUDED.provider_key_id,encrypted_descriptor=EXCLUDED.encrypted_descriptor,expires_at=EXCLUDED.expires_at,uploaded_at=EXCLUDED.uploaded_at",
                [
                    actor.id,
                    body.startupId,
                    actor.keyId,
                    encryptDescriptor(
                        descriptor,
                        this.options.descriptorEncryptionKey,
                    ),
                    body.expiresAt,
                    now,
                ],
            );
            return {
                uploaded: true,
                providerId: actor.id,
                startupId: body.startupId,
            };
        });
    }
    async getRequest(actor: Actor, id: string) {
        if (actor.actor !== "buyer")
            fail("UNAUTHORIZED", 401, "Buyer authorization required");
        return this.requestActor(actor, id, async (client, row) => {
            const original = grantOf(row).payload,
                now = this.now();
            const refreshed = grantSchema.parse({
                ...original,
                issuedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 120000).toISOString(),
                operations: ["get_request", "cancel_request"],
            });
            let descriptor: Descriptor | undefined;
            try {
                descriptor = await this.descriptor(
                    client,
                    original.providerId,
                    original.providerKeyId,
                );
            } catch (error) {
                if (
                    !(error instanceof AccountingError) ||
                    error.code !== "PROVIDER_UNAVAILABLE"
                )
                    throw error;
            }
            return {
                requestId: id,
                status: row.status,
                cancelRequested: row.cancel_requested,
                reconcileAfter: rowDate(row.reconcile_after).toISOString(),
                receipt: row.receipt ? receiptSchema.parse(row.receipt) : null,
                signedGrant: signDocument(
                    DOMAIN.grant,
                    refreshed,
                    this.options.platformPrivateKey,
                ),
                ...(descriptor ? { descriptor } : {}),
            };
        });
    }
    async cancel(actor: Actor, id: string) {
        if (actor.actor !== "buyer")
            fail("UNAUTHORIZED", 401, "Buyer authorization required");
        return this.requestActor(actor, id, async (client, row) => {
            if (!terminalStatuses.has(row.status))
                await client.query(
                    "UPDATE panas_accounting_requests SET cancel_requested=true WHERE request_id=$1",
                    [id],
                );
            return {
                requestId: id,
                status: row.status,
                cancelRequested:
                    !terminalStatuses.has(row.status) || row.cancel_requested,
                receipt: row.receipt ? receiptSchema.parse(row.receipt) : null,
            };
        });
    }
    private async ledger(
        client: PoolClient,
        id: string | null,
        kind: "fund" | "settle" | "refund",
        idem: string,
        entries: { account: string; amountAtomic: string }[],
    ) {
        if (entries.reduce((sum, e) => sum + BigInt(e.amountAtomic), 0n) !== 0n)
            throw new Error("Ledger transaction is not balanced");
        await client.query(
            "INSERT INTO panas_accounting_ledger(ledger_id,request_id,idempotency_key,kind,entries,created_at) VALUES($1,$2,$3,$4,$5,$6)",
            [randomUUID(), id, idem, kind, JSON.stringify(entries), this.now()],
        );
    }
    private async release(
        client: PoolClient,
        row: StoredRequest,
        settle: boolean,
    ) {
        const grant = grantOf(row).payload;
        await client.query(
            "UPDATE panas_accounting_buyers SET held=held-$2::numeric,balance=balance-$3::numeric WHERE buyer_id=$1",
            [row.buyer_id, grant.totalAtomic, settle ? grant.totalAtomic : "0"],
        );
        await client.query(
            "UPDATE panas_accounting_sessions SET held=held-$2::numeric,spent=spent+$3::numeric WHERE session_id=$1",
            [
                row.session_id,
                grant.totalAtomic,
                settle ? grant.totalAtomic : "0",
            ],
        );
        await client.query(
            "UPDATE panas_accounting_daily SET held=held-$3::numeric,spent=spent+$4::numeric WHERE buyer_id=$1 AND usage_day=$2",
            [
                row.buyer_id,
                row.usage_day,
                grant.totalAtomic,
                settle ? grant.totalAtomic : "0",
            ],
        );
    }
    async terminal(actor: Actor, id: string, input: unknown) {
        if (actor.actor !== "provider")
            fail("UNAUTHORIZED", 401, "Provider authorization required");
        const { event } = terminalInputSchema.parse(input);
        if (!verifyDocument(DOMAIN.terminal, event, actor.publicKeyPem))
            fail("UNAUTHORIZED", 401, "Provider terminal signature is invalid");
        const value = event.payload;
        return this.requestActor(actor, id, async (client, row) => {
            const grant = grantOf(row).payload;
            if (
                value.requestId !== id ||
                value.reservationId !== row.reservation_id ||
                value.grantId !== grant.grantId ||
                value.providerId !== grant.providerId ||
                value.startupId !== grant.startupId ||
                event.keyId !== grant.providerKeyId
            )
                fail("UNAUTHORIZED", 401, "Terminal event binding differs");
            if (
                Date.parse(value.completedAt) > this.now().getTime() + 5000 ||
                Date.parse(value.completedAt) <
                    rowDate(row.created_at).getTime() - 5000
            )
                fail(
                    "INVALID_INPUT",
                    400,
                    "Terminal event timestamp is invalid",
                );
            const eventDigest = digest(event),
                prior = (
                    await client.query(
                        "SELECT event_digest,request_id FROM panas_accounting_events WHERE event_id=$1",
                        [value.eventId],
                    )
                ).rows[0] as
                    { event_digest: string; request_id: string } | undefined;
            if (prior) {
                if (
                    prior.request_id !== id ||
                    prior.event_digest !== eventDigest
                )
                    fail("CONFLICT", 409, "Terminal event identifier changed");
                return {
                    requestId: id,
                    status: row.status,
                    receipt: row.receipt
                        ? receiptSchema.parse(row.receipt)
                        : null,
                };
            }
            if (terminalStatuses.has(row.status))
                fail(
                    "CONFLICT",
                    409,
                    "Request already has a durable terminal outcome",
                );
            if (value.outcome === "completed" && !row.authorized_at)
                fail("CONFLICT", 409, "Unadmitted work cannot be charged");
            await client.query(
                "INSERT INTO panas_accounting_events(event_id,request_id,event_digest,signed_event,received_at) VALUES($1,$2,$3,$4,$5)",
                [value.eventId, id, eventDigest, event, this.now()],
            );
            if (value.outcome === "unknown") {
                await client.query(
                    "UPDATE panas_accounting_requests SET status='pending' WHERE request_id=$1",
                    [id],
                );
                return { requestId: id, status: "pending", receipt: null };
            }
            const success = value.outcome === "completed";
            await this.release(client, row, success);
            if (success && BigInt(grant.totalAtomic) > 0n) {
                const entries = [
                    {
                        account: `buyer:${row.buyer_id}`,
                        amountAtomic: `-${grant.totalAtomic}`,
                    },
                ];
                if (BigInt(grant.providerAtomic) > 0n)
                    entries.push({
                        account: `provider:${grant.providerId}`,
                        amountAtomic: grant.providerAtomic,
                    });
                if (BigInt(grant.feeAtomic) > 0n)
                    entries.push({
                        account: "platform:fees",
                        amountAtomic: grant.feeAtomic,
                    });
                await this.ledger(
                    client,
                    id,
                    "settle",
                    `settle:${id}`,
                    entries,
                );
            }
            const receipt = receiptSchema.parse({
                receiptId: randomUUID(),
                requestId: id,
                status: value.outcome,
                currency: "TEST_CREDIT",
                buyerDebitAtomic: success ? grant.totalAtomic : "0",
                providerEarningsAtomic: success ? grant.providerAtomic : "0",
                feeAtomic: success ? grant.feeAtomic : "0",
                issuedAt: this.now().toISOString(),
                resultDigest: value.resultDigest,
                usage: value.usage,
            });
            await client.query(
                "UPDATE panas_accounting_requests SET status=$2,terminal_event_id=$3,receipt=$4 WHERE request_id=$1",
                [id, value.outcome, value.eventId, receipt],
            );
            return { requestId: id, status: value.outcome, receipt };
        });
    }
    async operatorEnrollBuyer(input: {
        buyerId: string;
        publicKeyPem: string;
        maxRequestAtomic: string;
        maxSessionAtomic: string;
        maxDailyAtomic: string;
        policyVersion: string;
    }) {
        z.uuid().parse(input.buyerId);
        if (createPublicKey(input.publicKeyPem).asymmetricKeyType !== "ed25519")
            throw new Error("Only Ed25519 buyer keys are allowed");
        for (const amount of [
            input.maxRequestAtomic,
            input.maxSessionAtomic,
            input.maxDailyAtomic,
        ])
            positive(amount);
        if (!input.policyVersion || input.policyVersion.length > 80)
            throw new Error("Policy version required");
        await this.pool.query(
            "INSERT INTO panas_accounting_buyers(buyer_id,public_key_pem,max_request,max_session,max_daily,policy_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(buyer_id) DO UPDATE SET public_key_pem=EXCLUDED.public_key_pem,enabled=true,max_request=EXCLUDED.max_request,max_session=EXCLUDED.max_session,max_daily=EXCLUDED.max_daily,policy_version=EXCLUDED.policy_version",
            [
                input.buyerId,
                input.publicKeyPem,
                input.maxRequestAtomic,
                input.maxSessionAtomic,
                input.maxDailyAtomic,
                input.policyVersion,
            ],
        );
    }
    async operatorOpenSession(input: {
        buyerId: string;
        sessionId: string;
        capAtomic: string;
        expiresAt: string;
    }) {
        z.uuid().parse(input.buyerId);
        z.uuid().parse(input.sessionId);
        positive(input.capAtomic);
        if (Date.parse(input.expiresAt) <= this.now().getTime())
            throw new Error("Session must expire in the future");
        const buyer = (
            await this.pool.query(
                "SELECT max_session::text FROM panas_accounting_buyers WHERE buyer_id=$1 AND enabled=true",
                [input.buyerId],
            )
        ).rows[0] as { max_session: string } | undefined;
        if (!buyer || BigInt(input.capAtomic) > BigInt(buyer.max_session))
            fail("SPENDING_LIMIT", 402, "Session cap exceeds owner policy");
        const old = (
            await this.pool.query(
                "SELECT buyer_id FROM panas_accounting_sessions WHERE session_id=$1",
                [input.sessionId],
            )
        ).rows[0] as { buyer_id: string } | undefined;
        if (old && old.buyer_id !== input.buyerId)
            fail("CONFLICT", 409, "Session belongs to another buyer");
        await this.pool.query(
            "INSERT INTO panas_accounting_sessions(session_id,buyer_id,cap,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO UPDATE SET cap=EXCLUDED.cap,enabled=true,expires_at=EXCLUDED.expires_at",
            [input.sessionId, input.buyerId, input.capAtomic, input.expiresAt],
        );
    }
    async operatorFund(input: {
        buyerId: string;
        amountAtomic: string;
        idempotencyKey: string;
    }) {
        z.uuid().parse(input.buyerId);
        z.uuid().parse(input.idempotencyKey);
        if (positive(input.amountAtomic) === 0n)
            throw new Error("Funding must be positive");
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const buyer = (
                await client.query(
                    "SELECT buyer_id FROM panas_accounting_buyers WHERE buyer_id=$1 FOR UPDATE",
                    [input.buyerId],
                )
            ).rows[0];
            if (!buyer) fail("NOT_FOUND", 404, "Buyer not found");
            const idem = `fund:${input.buyerId}:${input.idempotencyKey}`,
                old = (
                    await client.query(
                        "SELECT entries FROM panas_accounting_ledger WHERE idempotency_key=$1",
                        [idem],
                    )
                ).rows[0] as
                    | { entries: { account: string; amountAtomic: string }[] }
                    | undefined;
            if (old) {
                const credit = old.entries.find(
                    (e) => e.account === `buyer:${input.buyerId}`,
                );
                if (credit?.amountAtomic !== input.amountAtomic)
                    fail("CONFLICT", 409, "Funding key changed amount");
            } else {
                await client.query(
                    "UPDATE panas_accounting_buyers SET balance=balance+$2::numeric WHERE buyer_id=$1",
                    [input.buyerId, input.amountAtomic],
                );
                await this.ledger(client, null, "fund", idem, [
                    {
                        account: "issuer:test-credit",
                        amountAtomic: `-${input.amountAtomic}`,
                    },
                    {
                        account: `buyer:${input.buyerId}`,
                        amountAtomic: input.amountAtomic,
                    },
                ]);
            }
            await client.query("COMMIT");
            return {
                funded: true,
                buyerId: input.buyerId,
                currency: "TEST_CREDIT",
            };
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* Preserve failure. */
            }
            throw error;
        } finally {
            client.release();
        }
    }
    async operatorResolve(input: {
        requestId: string;
        action: "release" | "refund";
        reason: string;
    }) {
        z.uuid().parse(input.requestId);
        if (input.reason.trim().length < 10 || input.reason.length > 1000)
            throw new Error("Operator evidence reason required");
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const peek = (
                await client.query(
                    "SELECT buyer_id FROM panas_accounting_requests WHERE request_id=$1",
                    [input.requestId],
                )
            ).rows[0] as { buyer_id: string } | undefined;
            if (!peek) fail("NOT_FOUND", 404, "Request not found");
            await client.query(
                "SELECT buyer_id FROM panas_accounting_buyers WHERE buyer_id=$1 FOR UPDATE",
                [peek.buyer_id],
            );
            const row = (
                await client.query(
                    `SELECT ${REQUEST_COLUMNS} FROM panas_accounting_requests WHERE request_id=$1 FOR UPDATE`,
                    [input.requestId],
                )
            ).rows[0] as StoredRequest;
            const grant = grantOf(row).payload;
            let receipt: Receipt;
            if (input.action === "refund") {
                if (row.status === "refunded") {
                    await client.query("COMMIT");
                    return {
                        requestId: input.requestId,
                        status: row.status,
                        receipt: receiptSchema.parse(row.receipt),
                    };
                }
                if (row.status !== "completed")
                    fail(
                        "CONFLICT",
                        409,
                        "Only a settled request can be refunded",
                    );
                const original = receiptSchema.parse(row.receipt);
                await client.query(
                    "UPDATE panas_accounting_buyers SET balance=balance+$2::numeric WHERE buyer_id=$1",
                    [row.buyer_id, grant.totalAtomic],
                );
                if (BigInt(grant.totalAtomic) > 0n) {
                    const entries = [
                        {
                            account: `buyer:${row.buyer_id}`,
                            amountAtomic: grant.totalAtomic,
                        },
                    ];
                    if (BigInt(grant.providerAtomic) > 0n)
                        entries.push({
                            account: `provider:${grant.providerId}`,
                            amountAtomic: `-${grant.providerAtomic}`,
                        });
                    if (BigInt(grant.feeAtomic) > 0n)
                        entries.push({
                            account: "platform:fees",
                            amountAtomic: `-${grant.feeAtomic}`,
                        });
                    await this.ledger(
                        client,
                        input.requestId,
                        "refund",
                        `refund:${input.requestId}`,
                        entries,
                    );
                }
                receipt = receiptSchema.parse({
                    ...original,
                    receiptId: randomUUID(),
                    status: "refunded",
                    buyerDebitAtomic: "0",
                    providerEarningsAtomic: "0",
                    feeAtomic: "0",
                    issuedAt: this.now().toISOString(),
                    refundOf: original.receiptId,
                });
            } else {
                if (terminalStatuses.has(row.status))
                    fail("CONFLICT", 409, "Request already resolved");
                if (
                    rowDate(row.reconcile_after).getTime() >
                    this.now().getTime()
                )
                    fail(
                        "CONFLICT",
                        409,
                        "Reconciliation deadline has not elapsed",
                    );
                await this.release(client, row, false);
                receipt = receiptSchema.parse({
                    receiptId: randomUUID(),
                    requestId: input.requestId,
                    status: "failed",
                    currency: "TEST_CREDIT",
                    buyerDebitAtomic: "0",
                    providerEarningsAtomic: "0",
                    feeAtomic: "0",
                    issuedAt: this.now().toISOString(),
                    resultDigest: null,
                    usage: null,
                });
            }
            await client.query(
                "UPDATE panas_accounting_requests SET status=$2,receipt=$3 WHERE request_id=$1",
                [input.requestId, receipt.status, receipt],
            );
            await client.query(
                "INSERT INTO panas_accounting_operator_audit(audit_id,action,reference_id,reason,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6)",
                [
                    randomUUID(),
                    input.action,
                    input.requestId,
                    input.reason,
                    {
                        buyerId: row.buyer_id,
                        priorStatus: row.status,
                        receiptId: receipt.receiptId,
                    },
                    this.now(),
                ],
            );
            await client.query("COMMIT");
            return {
                requestId: input.requestId,
                status: receipt.status,
                receipt,
            };
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* Preserve original failure. */
            }
            throw error;
        } finally {
            client.release();
        }
    }
}
