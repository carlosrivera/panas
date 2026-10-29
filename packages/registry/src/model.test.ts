import { describe, expect, it } from "vitest";
import {
    publicProvider,
    readiness,
    validateReportEvidence,
    requireLiveLease,
} from "./model";
import { fixtureRecord, fixtureReport } from "./fixtures";
const now = new Date("2026-10-29T01:00:00Z");
it("requires fresh startup evidence once the heartbeat lease expires", () => {
    const record = fixtureRecord(now);
    expect(() =>
        requireLiveLease(record, new Date(now.getTime() + 44999)),
    ).not.toThrow();
    expect(() =>
        requireLiveLease(record, new Date(now.getTime() + 45000)),
    ).toThrow("Expired heartbeat");
});
describe("readiness from fresh evidence rather than cleanup jobs", () => {
    it("expires exactly at 45 seconds even when no cleanup ran", () => {
        const r = fixtureRecord(now);
        expect(readiness(r, new Date(now.getTime() + 44999)).ready).toBe(true);
        expect(readiness(r, new Date(now.getTime() + 45000))).toEqual({
            ready: false,
            reason: "heartbeat_expired",
        });
    });
    it("never promotes local-only or duplicate-check evidence", () => {
        const report = fixtureReport(now);
        report.peerProbe = { status: "unverified" };
        expect(() => validateReportEvidence(report, now)).toThrow(
            "Ready report lacks",
        );
        const duplicate = fixtureReport(now);
        duplicate.checks.push(duplicate.checks[0]!);
        expect(() => validateReportEvidence(duplicate, now)).toThrow(
            "Ready report lacks",
        );
    });
    it("rejects stale/future tests and a probe preceding tests", () => {
        for (const offset of [-300001, 5001])
            expect(() =>
                validateReportEvidence(
                    fixtureReport(new Date(now.getTime() + offset)),
                    now,
                ),
            ).toThrow("fresh");
        const r = fixtureReport(now);
        r.peerProbe.testedAt = new Date(now.getTime() - 1).toISOString();
        expect(() => validateReportEvidence(r, now)).toThrow("Peer probe");
    });
    it("projects only safe fields and labels self-reported evidence", () => {
        const result = publicProvider(fixtureRecord(now), now);
        const body = JSON.stringify(result);
        for (const secretField of [
            "checks",
            "detail",
            "memoryBytes",
            "freeDiskBytes",
            "publicKeyPem",
            "signature",
        ])
            expect(body).not.toContain(`"${secretField}"`);
        expect(result.evidence.source).toBe("provider-reported");
    });
});

it("rejects unsafe sequence integers before database access", async () => {
    const { heartbeatSchema } = await import("@panas/contracts/registry");
    const r = fixtureReport(now);
    expect(
        heartbeatSchema.safeParse({
            providerId: r.providerId,
            startupId: r.startupId,
            sequence: Number.MAX_SAFE_INTEGER + 1,
            reportDigest: "a".repeat(64),
            state: "ready",
        }).success,
    ).toBe(false);
});
