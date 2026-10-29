import { z } from "zod";
export const caseSchema = z
    .object({
        id: z.string(),
        status: z.enum(["passed", "failed", "pending", "not_run"]),
        source: z.enum([
            "real_cloud_one_mac",
            "component_fixture",
            "fault_injected_cloud_one_mac",
            "operator_attested_two_mac",
            "manual_pending",
        ]),
        detail: z.string(),
        durationMs: z.number().nonnegative().optional(),
        metrics: z
            .object({
                buyerDebitAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
                providerEarningsAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
                feeAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/),
                inputTokens: z.number().int().nonnegative(),
                outputTokens: z.number().int().nonnegative(),
                finishReason: z.enum(["stop", "length", "unknown"]),
            })
            .strict()
            .optional(),
        requestIds: z.array(z.uuid()).optional(),
        receiptIds: z.array(z.uuid()).optional(),
    })
    .strict();
export type CaseEvidence = z.infer<typeof caseSchema>;
export const evidenceSchema = z
    .object({
        version: z.literal(1),
        runId: z.uuid(),
        mode: z.enum([
            "local-simulation",
            "release-smoke",
            "manual-two-machine",
            "failure-fixtures",
            "fault-seams",
            "deadline-seam",
            "cancel-race-seam",
        ]),
        startedAt: z.iso.datetime(),
        finishedAt: z.iso.datetime(),
        gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
        releaseReference: z
            .object({
                projectId: z.literal("7db5f8f4-c378-4ba5-a48f-f435bc4c034b"),
                commit: z.string().regex(/^[a-f0-9]{40}$/),
                verifiedAt: z.iso.datetime(),
            })
            .strict()
            .optional(),
        sourceTreeDirty: z.boolean(),
        physicalMachineCount: z.number().int().min(0).max(2),
        logicalProviderCount: z.number().int().min(0).max(2),
        caseEvidence: z.array(caseSchema),
        gates: z
            .object({
                twoPhysicalMacs: z.enum([
                    "passed_operator_attested",
                    "pending",
                ]),
                release9: z.enum([
                    "pending",
                    "referenced_unverified",
                    "referenced_verified_report",
                ]),
                issue10Complete: z.literal(false),
            })
            .strict(),
        cleanup: z
            .object({
                ownedProcessesStopped: z.boolean(),
                runtimePortsClosed: z.boolean(),
            })
            .strict(),
    })
    .strict()
    .superRefine((report, ctx) => {
        if (
            [
                "local-simulation",
                "release-smoke",
                "fault-seams",
                "deadline-seam",
                "cancel-race-seam",
            ].includes(report.mode) &&
            (report.physicalMachineCount !== 1 ||
                report.gates.twoPhysicalMacs !== "pending")
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Two local providers cannot constitute two physical Mac evidence",
            });
        if (
            report.gates.twoPhysicalMacs === "passed_operator_attested" &&
            (report.mode !== "manual-two-machine" ||
                report.physicalMachineCount !== 2)
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Physical evidence requires explicit manual two-host mode",
            });
    });
export type RunEvidence = z.infer<typeof evidenceSchema>;
export const pendingPhysicalCase: CaseEvidence = {
    id: "two-physical-macs",
    status: "pending",
    source: "manual_pending",
    detail: "Second physical Mac exists but is inaccessible to this agent. Local logical providers are not separate physical machines.",
};
