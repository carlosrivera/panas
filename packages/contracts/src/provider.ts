import { z } from "zod";
import {
    checkResultSchema,
    providerStateSchema,
    requestLimitsSchema,
} from "./index.js";

export const requiredCapabilityChecks = [
    "platform",
    "runtime",
    "model",
    "memory",
    "disk",
    "inference",
    "limits",
    "exposure",
    "cancellation",
] as const;
export const capabilityReportSchema = z
    .object({
        schemaVersion: z.literal(1),
        providerId: z.uuid(),
        startupId: z.uuid(),
        sequence: z.number().int().nonnegative(),
        testedAt: z.iso.datetime(),
        platform: z.string(),
        architecture: z.string(),
        memoryBytes: z.number().int().nonnegative(),
        freeDiskBytes: z.number().int().nonnegative(),
        model: z
            .object({
                name: z.literal("qwen2.5:0.5b"),
                digest: z.string().min(1).nullable(),
                runtimeVersion: z.string().min(1).nullable(),
            })
            .strict(),
        profile: requestLimitsSchema,
        checks: z.array(checkResultSchema),
        peerProbe: z
            .object({
                status: z.enum(["verified", "unverified", "failed"]),
                testedAt: z.iso.datetime().optional(),
            })
            .strict(),
        benchmark: z
            .object({
                warmLatencyMs: z.number().nonnegative(),
                tokensPerSecond: z.number().nonnegative(),
            })
            .strict()
            .nullable(),
        state: providerStateSchema,
    })
    .strict();
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;
export function passedLocalCapabilities(report: CapabilityReport): boolean {
    return (
        report.model.digest !== null &&
        report.model.runtimeVersion !== null &&
        report.benchmark !== null &&
        requiredCapabilityChecks.every(
            (name) =>
                report.checks.filter((c) => c.name === name).length === 1 &&
                report.checks.some((c) => c.name === name && c.passed),
        )
    );
}
export function isReadyCapabilityReport(report: CapabilityReport): boolean {
    return (
        report.state === "ready" &&
        passedLocalCapabilities(report) &&
        report.peerProbe.status === "verified" &&
        report.peerProbe.testedAt !== undefined
    );
}

export const providerConfigSchema = z
    .object({
        providerId: z.uuid(),
        expectedDigest: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/),
        expectedRuntimeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
        dataPath: z
            .string()
            .refine(
                (value) => value.startsWith("/"),
                "Use an absolute dedicated application directory",
            ),
        binary: z
            .string()
            .refine(
                (value) => value.startsWith("/"),
                "Use an explicit absolute Ollama binary path",
            ),
        modelsPath: z
            .string()
            .refine(
                (value) => value.startsWith("/"),
                "Use an explicit absolute model directory",
            ),
        endpoint: z.url(),
    })
    .strict();
