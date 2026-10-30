import { expect, it } from "vitest";
import { validReleaseReference, requiredReleaseChecks } from "./release.js";
import { TEST_ACCOUNTING_URL, TEST_REGISTRY_URL } from "./config.js";
const proof = {
    schemaVersion: 1,
    scope: "panas-test",
    projectId: "7db5f8f4-c378-4ba5-a48f-f435bc4c034b",
    commit: "a".repeat(40),
    verifiedAt: new Date().toISOString(),
    status: "verified",
    lockfileSha256: "b".repeat(64),
    functions: [
        { name: "registry", invokeUrl: TEST_REGISTRY_URL },
        { name: "accounting", invokeUrl: TEST_ACCOUNTING_URL },
    ],
    checks: requiredReleaseChecks.map((name) => ({ name, passed: true })),
    migration: { mode: "tracked", applied: 37, adopted: 0, total: 37 },
};
it("references only the exact Panas test project and complete named release checks", () => {
    expect(validReleaseReference(proof)).toBe(true);
    expect(
        validReleaseReference({
            ...proof,
            functions: [...proof.functions, { name: "operations" }],
        }),
    ).toBe(true);
    expect(
        validReleaseReference({
            ...proof,
            projectId: "11111111-1111-4111-8111-111111111111",
        }),
    ).toBe(false);
    expect(
        validReleaseReference({
            ...proof,
            checks: Array.from({ length: 7 }, () => ({
                name: "anything",
                passed: true,
            })),
        }),
    ).toBe(false);
    expect(
        validReleaseReference({ ...proof, checks: proof.checks.slice(0, -1) }),
    ).toBe(false);
    expect(
        validReleaseReference({
            ...proof,
            functions: [{ name: "registry", invokeUrl: "https://example.com" }],
        }),
    ).toBe(false);
    expect(
        validReleaseReference({
            ...proof,
            migration: { ...proof.migration, total: 36 },
        }),
    ).toBe(false);
});
