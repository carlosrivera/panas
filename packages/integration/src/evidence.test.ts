import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { evidenceSchema } from "./evidence.js";
import {
    manualConfigSchema,
    TEST_ACCOUNTING_URL,
    TEST_REGISTRY_URL,
} from "./config.js";
const base = {
    version: 1,
    runId: randomUUID(),
    mode: "local-simulation",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    gitCommit: "a".repeat(40),
    sourceTreeDirty: false,
    physicalMachineCount: 1,
    logicalProviderCount: 2,
    caseEvidence: [],
    gates: {
        twoPhysicalMacs: "pending",
        release9: "pending",
        issue10Complete: false,
    },
    cleanup: { ownedProcessesStopped: true, runtimePortsClosed: true },
};
it("does not upgrade two local providers into two physical Macs or issue completion", () => {
    expect(evidenceSchema.safeParse(base).success).toBe(true);
    expect(
        evidenceSchema.safeParse({ ...base, physicalMachineCount: 2 }).success,
    ).toBe(false);
    expect(
        evidenceSchema.safeParse({
            ...base,
            gates: {
                ...base.gates,
                twoPhysicalMacs: "passed_operator_attested",
            },
        }).success,
    ).toBe(false);
    expect(
        evidenceSchema.safeParse({
            ...base,
            gates: { ...base.gates, issue10Complete: true },
        }).success,
    ).toBe(false);
});
it("requires explicit distinct manual host declarations rather than a logical-provider count", () => {
    const input = {
        version: 1,
        mode: "manual-two-machine",
        physicalMachineCount: 2,
        privateDir: "/tmp/private",
        registryUrl: TEST_REGISTRY_URL,
        accountingUrl: TEST_ACCOUNTING_URL,
        buyerConfigPath: "/tmp/private/buyer.json",
        physicalHosts: [
            { alias: "mac-a", providerId: randomUUID() },
            { alias: "mac-b", providerId: randomUUID() },
        ],
        operatorAttestation:
            "The operator must actually verify these are separate physical Macs before running.",
    };
    expect(manualConfigSchema.safeParse(input).success).toBe(true);
    expect(
        manualConfigSchema.safeParse({
            ...input,
            physicalHosts: [input.physicalHosts[0], input.physicalHosts[0]],
        }).success,
    ).toBe(false);
    expect(
        manualConfigSchema.safeParse({ ...input, operatorAttestation: "" })
            .success,
    ).toBe(false);
});
it("strict evidence prevents raw secret-bearing fields from entering the public report", () => {
    for (const field of [
        "ticket",
        "signedGrant",
        "privateKey",
        "prompt",
        "databaseUrl",
    ]) {
        expect(
            evidenceSchema.safeParse({ ...base, [field]: "PRIVATE" }).success,
        ).toBe(false);
    }
});
