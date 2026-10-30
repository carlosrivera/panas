import { randomUUID } from "node:crypto";
import { prototypeLimits } from "@panas/contracts";
import {
    requiredCapabilityChecks,
    type CapabilityReport,
} from "@panas/contracts/provider";
import type { StoredProvider } from "./model.js";
export function fixtureReport(
    now: Date,
    providerId: string = randomUUID(),
): CapabilityReport {
    return {
        schemaVersion: 1,
        providerId,
        startupId: randomUUID(),
        sequence: 0,
        testedAt: now.toISOString(),
        platform: "linux",
        architecture: "arm64",
        memoryBytes: 16 * 1024 ** 3,
        freeDiskBytes: 10 * 1024 ** 3,
        model: {
            name: "qwen2.5:0.5b",
            digest: "a".repeat(64),
            runtimeVersion: "0.23.4",
        },
        profile: prototypeLimits,
        checks: requiredCapabilityChecks.map((name) => ({
            name,
            passed: true,
            detail: "deterministic fixture, not hardware evidence",
        })),
        peerProbe: { status: "verified", testedAt: now.toISOString() },
        benchmark: { warmLatencyMs: 100, tokensPerSecond: 20 },
        state: "ready",
    };
}
export function fixtureRecord(now: Date): StoredProvider {
    const report = fixtureReport(now);
    return {
        providerId: report.providerId,
        eligible: true,
        retiredAt: null,
        report,
        price: { version: "v1", totalAtomic: "100", currency: "TEST_CREDIT" },
        reportDigest: "a".repeat(64),
        sequence: 0,
        state: "ready",
        receivedAt: now,
        createdAt: now,
    };
}
