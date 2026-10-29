import { z } from "zod";
import {
    discoveryQuerySchema,
    heartbeatSchema,
    registrationSchema,
    type DiscoveryQuery,
} from "@panas/contracts/registry";
import { verifyProviderProof, type RequestProof } from "./auth.js";
import { RegistryError } from "./errors.js";
import { digest, publicProvider, validateReportEvidence } from "./model.js";
import type { RegistryRepository } from "./repository.js";

const cursorSchema = z
    .object({
        after: z.uuid(),
        asOf: z.iso.datetime(),
        filter: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
export class RegistryService {
    constructor(
        private readonly repository: RegistryRepository,
        private readonly clock: () => Date = () => new Date(),
    ) {}
    async register(rawBody: string, proof: RequestProof) {
        const now = this.clock();
        const data = registrationSchema.parse(JSON.parse(rawBody));
        if (data.report.providerId !== proof.providerId)
            throw new RegistryError(
                "UNAUTHORIZED",
                401,
                "Provider identity mismatch",
            );
        const enrolledKey = await this.repository.getKey(proof.providerId);
        verifyProviderProof(
            enrolledKey,
            proof,
            "/providers/register",
            rawBody,
            now,
        );
        validateReportEvidence(data.report, now);
        const record = await this.repository.register(
            data,
            proof.nonce,
            now,
            enrolledKey?.publicKeyPem,
        );
        return {
            reportDigest: record.reportDigest,
            sequence: record.sequence,
            heartbeatIntervalMs: 15000,
            ...publicProvider(record, now),
        };
    }
    async heartbeat(rawBody: string, proof: RequestProof) {
        const now = this.clock();
        const data = heartbeatSchema.parse(JSON.parse(rawBody));
        if (data.providerId !== proof.providerId)
            throw new RegistryError(
                "UNAUTHORIZED",
                401,
                "Provider identity mismatch",
            );
        const enrolledKey = await this.repository.getKey(proof.providerId);
        verifyProviderProof(
            enrolledKey,
            proof,
            "/providers/heartbeat",
            rawBody,
            now,
        );
        return publicProvider(
            await this.repository.heartbeat(
                data,
                proof.nonce,
                now,
                enrolledKey?.publicKeyPem,
            ),
            now,
        );
    }
    async getProvider(id: string) {
        z.uuid().parse(id);
        const record = await this.repository.get(id);
        if (!record)
            throw new RegistryError("NOT_FOUND", 404, "Provider not found");
        return publicProvider(record, this.clock());
    }
    async discover(input: unknown) {
        const query = discoveryQuerySchema.parse(input);
        const now = this.clock();
        const { cursor, ...filters } = query;
        const filter = digest(filters);
        let after: string | null = null;
        let asOf = now;
        if (cursor) {
            try {
                const decoded = cursorSchema.parse(
                    JSON.parse(
                        Buffer.from(cursor, "base64url").toString("utf8"),
                    ),
                );
                if (
                    decoded.filter !== filter ||
                    Date.parse(decoded.asOf) > now.getTime() ||
                    now.getTime() - Date.parse(decoded.asOf) > 300000
                )
                    throw new Error("Expired or changed query");
                after = decoded.after;
                asOf = new Date(decoded.asOf);
            } catch {
                throw new RegistryError(
                    "INVALID_INPUT",
                    400,
                    "Invalid or expired discovery cursor",
                );
            }
        }
        const rows = await this.repository.discover(query, after, asOf, now);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
            providers: page.map((record) => publicProvider(record, now)),
            observedAt: now.toISOString(),
            nextCursor:
                rows.length > query.limit && last
                    ? Buffer.from(
                          JSON.stringify({
                              after: last.providerId,
                              asOf: asOf.toISOString(),
                              filter,
                          }),
                      ).toString("base64url")
                    : null,
        };
    }
}
export function queryFromUrl(url: URL): DiscoveryQuery {
    const input: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(input, key))
            throw new RegistryError(
                "INVALID_INPUT",
                400,
                "Duplicate query parameter",
            );
        input[key] = [
            "limit",
            "minContextTokens",
            "minOutputTokens",
            "maxLatencyMs",
        ].includes(key)
            ? Number(value)
            : key === "readyOnly"
              ? value === "true"
                  ? true
                  : value === "false"
                    ? false
                    : value
              : value;
    }
    return discoveryQuerySchema.parse(input);
}
