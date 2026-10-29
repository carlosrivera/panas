import { createHash } from "node:crypto";
import {
    isReadyCapabilityReport,
    type CapabilityReport,
} from "@panas/contracts/provider";
import type { RegistryPrice } from "@panas/contracts/registry";
import { RegistryError } from "./errors.js";

export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_TTL_MS = 45000;
export const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
export interface StoredProvider {
    providerId: string;
    eligible: boolean;
    retiredAt: Date | null;
    report: CapabilityReport;
    price: RegistryPrice;
    reportDigest: string;
    sequence: number;
    state: CapabilityReport["state"];
    receivedAt: Date;
    createdAt: Date;
}
/** An expired lease cannot be revived by a delayed heartbeat or the same startup. */
export function requireLiveLease(record: StoredProvider, now: Date): void {
    if (record.receivedAt.getTime() + HEARTBEAT_TTL_MS <= now.getTime())
        throw new RegistryError(
            "STALE_REPORT",
            409,
            "Expired heartbeat requires a new startup and fresh tests",
        );
}
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
export function digest(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function validateReportEvidence(
    report: CapabilityReport,
    now: Date,
): void {
    const tested = Date.parse(report.testedAt);
    if (tested > now.getTime() + 5000 || now.getTime() - tested > 5 * 60 * 1000)
        throw new RegistryError(
            "STALE_REPORT",
            409,
            "Registration requires a fresh capability report",
        );
    if (
        report.state === "ready" &&
        (!isReadyCapabilityReport(report) ||
            report.platform !== "darwin" ||
            report.architecture !== "arm64")
    )
        throw new RegistryError(
            "INVALID_EVIDENCE",
            422,
            "Ready report lacks required capability evidence",
        );
    const probeAt =
        report.peerProbe.testedAt === undefined
            ? null
            : Date.parse(report.peerProbe.testedAt);
    if (
        report.peerProbe.status === "verified" &&
        (probeAt === null || probeAt < tested || probeAt > now.getTime() + 5000)
    )
        throw new RegistryError(
            "INVALID_EVIDENCE",
            422,
            "Peer probe must follow capability tests and not be in the future",
        );
}
export function readiness(
    record: StoredProvider,
    now: Date,
): { ready: boolean; reason: string } {
    if (record.receivedAt.getTime() + HEARTBEAT_TTL_MS <= now.getTime())
        return { ready: false, reason: "heartbeat_expired" };
    if (Date.parse(record.report.testedAt) + REPORT_TTL_MS <= now.getTime())
        return { ready: false, reason: "capability_report_expired" };
    if (!record.eligible)
        return { ready: false, reason: "capability_evidence_unverified" };
    if (record.state !== "ready")
        return { ready: false, reason: `provider_${record.state}` };
    if (!isReadyCapabilityReport(record.report))
        return { ready: false, reason: "capability_evidence_unverified" };
    return { ready: true, reason: "ready" };
}
export function publicProvider(record: StoredProvider, now: Date) {
    return {
        providerId: record.providerId,
        startupId: record.report.startupId,
        capability: "text-inference" as const,
        model: record.report.model,
        profile: record.report.profile,
        price: record.price,
        benchmark: record.report.benchmark,
        testedAt: record.report.testedAt,
        lastSeenAt: record.receivedAt.toISOString(),
        expiresAt: new Date(
            record.receivedAt.getTime() + HEARTBEAT_TTL_MS,
        ).toISOString(),
        state: record.state,
        readiness: readiness(record, now),
        evidence: {
            source: "provider-reported" as const,
            peerProbe: record.report.peerProbe.status,
        },
    };
}
