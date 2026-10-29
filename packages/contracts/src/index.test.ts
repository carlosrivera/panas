import { describe, expect, it } from "vitest";
import {
    atomicAmountSchema,
    fixedQuoteSchema,
    localReportSchema,
    prototypeLimits,
    requestLimitsSchema,
} from "./index";

describe("spending and device contract boundaries", () => {
    it("rejects fractional, negative, exponential, and ambiguous monetary values", () => {
        for (const value of ["-1", "1.5", "1e6", "01", "", "1".repeat(31)])
            expect(atomicAmountSchema.safeParse(value).success).toBe(false);
        expect(atomicAmountSchema.parse("9007199254740993")).toBe(
            "9007199254740993",
        );
    });
    it("rejects workloads outside the bounded prototype profile", () => {
        expect(
            requestLimitsSchema.safeParse({
                ...prototypeLimits,
                concurrency: 2,
            }).success,
        ).toBe(false);
        expect(
            requestLimitsSchema.safeParse({
                ...prototypeLimits,
                maxOutputTokens: 129,
            }).success,
        ).toBe(false);
    });
    it("does not permit a local-only report to declare readiness", () => {
        expect(
            localReportSchema.safeParse({
                schemaVersion: 1,
                startupId: crypto.randomUUID(),
                testedAt: new Date().toISOString(),
                state: "ready",
                platform: "darwin",
                architecture: "arm64",
                memoryBytes: 1,
                model: "test",
                checks: [],
            }).success,
        ).toBe(false);
    });
    it("rejects variable pricing or undisclosed properties in a fixed quote", () => {
        expect(
            fixedQuoteSchema.safeParse({
                id: crypto.randomUUID(),
                providerId: crypto.randomUUID(),
                startupId: crypto.randomUUID(),
                buyerKeyId: "buyer",
                modelDigest: "digest",
                priceVersion: "1",
                totalAtomic: "10",
                currency: "TEST_CREDIT",
                limits: prototypeLimits,
                expiresAt: new Date().toISOString(),
                perTokenPrice: 10,
            }).success,
        ).toBe(false);
    });
});
