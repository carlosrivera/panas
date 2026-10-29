import { readFile } from "node:fs/promises";
import { z } from "zod";
import { TEST_ACCOUNTING_URL, TEST_REGISTRY_URL } from "./config.js";
export const requiredReleaseChecks = [
    "anonymous_public_api",
    "anonymous_api_authorization",
    "accounting_authorization",
    "authenticated_mcp",
    "private_operational_health",
    "frontend",
    "frontend_assets",
] as const;
const proofSchema = z.object({
    schemaVersion: z.literal(1),
    scope: z.literal("panas-test"),
    projectId: z.literal("7db5f8f4-c378-4ba5-a48f-f435bc4c034b"),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    verifiedAt: z.iso.datetime(),
    status: z.literal("verified"),
    lockfileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    functions: z.array(z.object({ name: z.string(), invokeUrl: z.url() })),
    checks: z.array(z.object({ name: z.string(), passed: z.literal(true) })),
    migration: z.object({
        mode: z.literal("tracked"),
        applied: z.number().int().nonnegative(),
        adopted: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
    }),
});
export function validReleaseReference(input: unknown): boolean {
    const result = proofSchema.safeParse(input);
    if (!result.success) return false;
    const proof = result.data,
        urls = new Set(
            proof.functions.map((f) => f.invokeUrl.replace(/\/$/, "")),
        ),
        names = new Set(proof.checks.map((c) => c.name));
    return (
        urls.has(TEST_REGISTRY_URL) &&
        urls.has(TEST_ACCOUNTING_URL) &&
        requiredReleaseChecks.every((name) => names.has(name)) &&
        proof.migration.total >=
            proof.migration.applied + proof.migration.adopted
    );
}
/** Validates the referenced producer report, not an independent re-probe of the deployed endpoints. */
export async function inspectRelease(path?: string): Promise<{
    status: "pending" | "referenced_unverified" | "referenced_verified_report";
    reference?: { projectId: string; commit: string; verifiedAt: string };
}> {
    if (!path) return { status: "pending" };
    try {
        const input: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!validReleaseReference(input))
            return { status: "referenced_unverified" };
        const proof = proofSchema.parse(input);
        return {
            status: "referenced_verified_report",
            reference: {
                projectId: proof.projectId,
                commit: proof.commit,
                verifiedAt: proof.verifiedAt,
            },
        };
    } catch {
        return { status: "referenced_unverified" };
    }
}
export async function releaseGate(path?: string) {
    return (await inspectRelease(path)).status;
}
