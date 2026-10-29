import type { CapabilityReport } from "@panas/contracts/provider";
import type {
    DiscoveryQuery,
    Heartbeat,
    Registration,
} from "@panas/contracts/registry";
import type { Pool, PoolClient } from "pg";
import {
    capabilityReportSchema,
    isReadyCapabilityReport,
} from "@panas/contracts/provider";
import { registryPriceSchema } from "@panas/contracts/registry";
import type { ProviderKey } from "./auth.js";
import { RegistryError } from "./errors.js";
import {
    digest,
    HEARTBEAT_TTL_MS,
    REPORT_TTL_MS,
    type StoredProvider,
} from "./model.js";

export interface RegistryRepository {
    getKey(id: string): Promise<ProviderKey | null>;
    register(
        data: Registration,
        nonce: string,
        now: Date,
        expectedKey?: string,
    ): Promise<StoredProvider>;
    heartbeat(
        data: Heartbeat,
        nonce: string,
        now: Date,
        expectedKey?: string,
    ): Promise<StoredProvider>;
    get(id: string): Promise<StoredProvider | null>;
    discover(
        query: DiscoveryQuery,
        after: string | null,
        asOf: Date,
        now: Date,
    ): Promise<StoredProvider[]>;
}
function storedDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(String(value));
}
function fromRow(row: Record<string, unknown>): StoredProvider {
    return {
        providerId: String(row.provider_id),
        eligible: row.eligible === true,
        retiredAt: row.retired_at ? storedDate(row.retired_at) : null,
        report: capabilityReportSchema.parse(row.report),
        price: registryPriceSchema.parse(row.price),
        reportDigest: String(row.report_digest),
        sequence: Number(row.sequence),
        state: String(row.state) as CapabilityReport["state"],
        receivedAt: storedDate(row.received_at),
        createdAt: storedDate(row.created_at),
    };
}
export class PostgresRegistryRepository implements RegistryRepository {
    constructor(private readonly pool: Pool) {}
    async getKey(id: string): Promise<ProviderKey | null> {
        const row = (
            await this.pool.query(
                "SELECT provider_id, public_key_pem, enabled FROM panas_provider_keys WHERE provider_id=$1",
                [id],
            )
        ).rows[0] as Record<string, unknown> | undefined;
        return row
            ? {
                  providerId: String(row.provider_id),
                  publicKeyPem: String(row.public_key_pem),
                  enabled: row.enabled === true,
              }
            : null;
    }
    private async mutation<T>(
        id: string,
        nonce: string,
        now: Date,
        action: (client: PoolClient) => Promise<T>,
        expectedKey?: string,
    ): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const key = (
                await client.query(
                    "SELECT enabled, public_key_pem FROM panas_provider_keys WHERE provider_id=$1 FOR UPDATE",
                    [id],
                )
            ).rows[0] as
                { enabled: boolean; public_key_pem: string } | undefined;
            if (
                !key?.enabled ||
                (expectedKey !== undefined &&
                    key.public_key_pem !== expectedKey)
            )
                throw new RegistryError(
                    "UNAUTHORIZED",
                    401,
                    "Provider is not authorized",
                );
            await client.query(
                "DELETE FROM panas_registry_nonces WHERE provider_id=$1 AND expires_at <= $2",
                [id, now],
            );
            const inserted = await client.query(
                "INSERT INTO panas_registry_nonces(provider_id,nonce,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce",
                [id, nonce, new Date(now.getTime() + 300000)],
            );
            if (inserted.rowCount !== 1)
                throw new RegistryError(
                    "REPLAYED_REQUEST",
                    409,
                    "Authorization nonce already used",
                );
            const result = await action(client);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
    async register(
        data: Registration,
        nonce: string,
        now: Date,
        expectedKey?: string,
    ): Promise<StoredProvider> {
        return this.mutation(
            data.report.providerId,
            nonce,
            now,
            async (client) => {
                // Serialize first registration as well as updates, using the enrollment row as a per-provider lock.
                await client.query(
                    "SELECT provider_id FROM panas_provider_keys WHERE provider_id=$1 FOR UPDATE",
                    [data.report.providerId],
                );
                const row = (
                    await client.query(
                        "SELECT provider_id,startup_id,sequence,report_digest,report,price,state,eligible,received_at,created_at,retired_at FROM panas_registry_current WHERE provider_id=$1 FOR UPDATE",
                        [data.report.providerId],
                    )
                ).rows[0] as Record<string, unknown> | undefined;
                const existing = row ? fromRow(row) : null;
                const reportDigest = digest(data);
                if (existing) {
                    if (
                        data.report.state === "ready" &&
                        existing.retiredAt !== null &&
                        Date.parse(data.report.testedAt) <=
                            existing.retiredAt.getTime()
                    )
                        throw new RegistryError(
                            "INVALID_EVIDENCE",
                            422,
                            "Retired evidence requires tests after retirement",
                        );
                    if (existing.report.startupId === data.report.startupId) {
                        if (
                            data.report.sequence === existing.sequence &&
                            reportDigest === existing.reportDigest
                        )
                            return existing;
                        if (
                            data.report.sequence <= existing.sequence ||
                            Date.parse(data.report.testedAt) <
                                Date.parse(existing.report.testedAt)
                        )
                            throw new RegistryError(
                                "OUT_OF_ORDER",
                                409,
                                "Report sequence must advance",
                            );
                    } else if (
                        data.report.sequence !== 0 ||
                        Date.parse(data.report.testedAt) <=
                            Date.parse(existing.report.testedAt)
                    )
                        throw new RegistryError(
                            "OUT_OF_ORDER",
                            409,
                            "New startup requires a newer test report and sequence zero",
                        );
                } else if (data.report.sequence !== 0)
                    throw new RegistryError(
                        "OUT_OF_ORDER",
                        409,
                        "First registration requires sequence zero",
                    );
                await client.query(
                    "INSERT INTO panas_registry_reports(provider_id,startup_id,sequence,report_digest,report,price,received_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
                    [
                        data.report.providerId,
                        data.report.startupId,
                        data.report.sequence,
                        reportDigest,
                        data.report,
                        data.price,
                        now,
                    ],
                );
                const updated = await client.query(
                    "INSERT INTO panas_registry_current(provider_id,startup_id,sequence,report_digest,report,price,state,received_at,created_at,eligible,retired_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10) ON CONFLICT(provider_id) DO UPDATE SET startup_id=EXCLUDED.startup_id,sequence=EXCLUDED.sequence,report_digest=EXCLUDED.report_digest,report=EXCLUDED.report,price=EXCLUDED.price,state=EXCLUDED.state,received_at=EXCLUDED.received_at,eligible=EXCLUDED.eligible,retired_at=EXCLUDED.retired_at RETURNING provider_id,startup_id,sequence,report_digest,report,price,state,eligible,received_at,created_at,retired_at",
                    [
                        data.report.providerId,
                        data.report.startupId,
                        data.report.sequence,
                        reportDigest,
                        data.report,
                        data.price,
                        data.report.state,
                        now,
                        data.report.state === "ready",
                        data.report.state === "ready"
                            ? null
                            : ["unhealthy", "offline"].includes(
                                    data.report.state,
                                )
                              ? now
                              : (existing?.retiredAt ?? null),
                    ],
                );
                return fromRow(updated.rows[0] as Record<string, unknown>);
            },
            expectedKey,
        );
    }
    async heartbeat(
        data: Heartbeat,
        nonce: string,
        now: Date,
        expectedKey?: string,
    ): Promise<StoredProvider> {
        return this.mutation(
            data.providerId,
            nonce,
            now,
            async (client) => {
                const row = (
                    await client.query(
                        "SELECT provider_id,startup_id,sequence,report_digest,report,price,state,eligible,received_at,created_at,retired_at FROM panas_registry_current WHERE provider_id=$1 FOR UPDATE",
                        [data.providerId],
                    )
                ).rows[0] as Record<string, unknown> | undefined;
                if (!row)
                    throw new RegistryError(
                        "NOT_FOUND",
                        404,
                        "Provider has not registered",
                    );
                const record = fromRow(row);
                if (
                    data.startupId !== record.report.startupId ||
                    data.reportDigest !== record.reportDigest ||
                    data.sequence < record.sequence ||
                    (data.sequence === record.sequence &&
                        data.state !== record.state)
                )
                    throw new RegistryError(
                        "OUT_OF_ORDER",
                        409,
                        "Heartbeat does not match the current report/startup sequence",
                    );
                if (data.sequence === record.sequence) return record; // A retry cannot extend liveness.
                if (
                    data.state === "ready" &&
                    (!record.eligible ||
                        !isReadyCapabilityReport(record.report))
                )
                    throw new RegistryError(
                        "INVALID_EVIDENCE",
                        422,
                        "A ready report must be registered before ready heartbeats",
                    );
                const updated = await client.query(
                    "UPDATE panas_registry_current SET sequence=$2,state=$3,received_at=$4,eligible=CASE WHEN $3 IN ('unhealthy','offline','testing') THEN false ELSE eligible END,retired_at=CASE WHEN $3 IN ('unhealthy','offline','testing') THEN $4 ELSE retired_at END WHERE provider_id=$1 RETURNING provider_id,startup_id,sequence,report_digest,report,price,state,eligible,received_at,created_at,retired_at",
                    [data.providerId, data.sequence, data.state, now],
                );
                return fromRow(updated.rows[0] as Record<string, unknown>);
            },
            expectedKey,
        );
    }
    async get(id: string): Promise<StoredProvider | null> {
        const row = (
            await this.pool.query(
                "SELECT p.provider_id,p.startup_id,p.sequence,p.report_digest,p.report,p.price,p.state,p.eligible,p.received_at,p.created_at,p.retired_at FROM panas_registry_current p JOIN panas_provider_keys k USING(provider_id) WHERE p.provider_id=$1 AND k.enabled=true",
                [id],
            )
        ).rows[0] as Record<string, unknown> | undefined;
        return row ? fromRow(row) : null;
    }
    async discover(
        query: DiscoveryQuery,
        after: string | null,
        asOf: Date,
        now: Date,
    ): Promise<StoredProvider[]> {
        const { rows } = await this.pool.query(
            `SELECT p.provider_id,p.startup_id,p.sequence,p.report_digest,p.report,p.price,p.state,p.eligible,p.received_at,p.created_at,p.retired_at FROM panas_registry_current p JOIN panas_provider_keys k USING(provider_id)
            WHERE k.enabled=true AND ($1::uuid IS NULL OR p.provider_id>$1) AND p.created_at<=$2
            AND ($3::text IS NULL OR p.report->'model'->>'name'=$3)
            AND ($4::integer IS NULL OR (p.report->'profile'->>'maxContextTokens')::integer >= $4)
            AND ($5::integer IS NULL OR (p.report->'profile'->>'maxOutputTokens')::integer >= $5)
            AND ($6::numeric IS NULL OR (p.price->>'totalAtomic')::numeric <= $6)
            AND ($7::numeric IS NULL OR (p.report->'benchmark'->>'warmLatencyMs')::numeric <= $7)
            AND ($8::boolean=false OR (p.state='ready' AND p.eligible=true AND p.received_at>$9 AND (p.report->>'testedAt')::timestamptz>$10))
            ORDER BY p.provider_id LIMIT $11`,
            [
                after,
                asOf,
                query.model ?? null,
                query.minContextTokens ?? null,
                query.minOutputTokens ?? null,
                query.maxPriceAtomic ?? null,
                query.maxLatencyMs ?? null,
                query.readyOnly,
                new Date(now.getTime() - HEARTBEAT_TTL_MS),
                new Date(now.getTime() - REPORT_TTL_MS),
                query.limit + 1,
            ],
        );
        return rows.map((row) => fromRow(row as Record<string, unknown>));
    }
}
