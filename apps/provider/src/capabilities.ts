import { arch, platform, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prototypeLimits } from "@panas/contracts";
import {
    capabilityReportSchema,
    type CapabilityReport,
} from "@panas/contracts/provider";
import type { InferenceRuntime } from "./runtime.js";

export interface HostInfo {
    platform: string;
    architecture: string;
    osMajor: number;
    memoryBytes: number;
    freeDiskBytes: number;
}
export interface CapabilityConfig {
    providerId: string;
    expectedDigest: string;
    expectedRuntimeVersion: string;
    dataPath: string;
}
export async function inspectHost(dataPath: string): Promise<HostInfo> {
    const fs = await statfs(dataPath);
    const osMajor =
        platform() === "darwin"
            ? Number(
                  (
                      await promisify(execFile)("/usr/bin/sw_vers", [
                          "-productVersion",
                      ])
                  ).stdout
                      .trim()
                      .split(".")[0],
              )
            : 0;
    return {
        platform: platform(),
        architecture: arch(),
        osMajor,
        memoryBytes: totalmem(),
        freeDiskBytes: fs.bavail * fs.bsize,
    };
}
export async function testCapabilities(
    config: CapabilityConfig,
    runtime: InferenceRuntime,
    host: HostInfo,
    startupId = randomUUID(),
    now = () => Date.now(),
): Promise<CapabilityReport> {
    const checks: CapabilityReport["checks"] = [];
    const check = (name: string, passed: boolean, detail: string) =>
        checks.push({ name, passed, detail });
    const report: CapabilityReport = {
        schemaVersion: 1,
        providerId: config.providerId,
        startupId,
        sequence: 0,
        testedAt: new Date(now()).toISOString(),
        platform: host.platform,
        architecture: host.architecture,
        memoryBytes: host.memoryBytes,
        freeDiskBytes: host.freeDiskBytes,
        model: { name: "qwen2.5:0.5b", digest: null, runtimeVersion: null },
        profile: { ...prototypeLimits },
        checks,
        peerProbe: { status: "unverified" },
        benchmark: null,
        state: "unhealthy",
    };
    check(
        "platform",
        host.platform === "darwin" &&
            host.architecture === "arm64" &&
            host.osMajor >= 14,
        "Requires macOS14+ on Apple Silicon",
    );
    check(
        "memory",
        host.memoryBytes >= 4 * 1024 ** 3,
        "Requires at least4GiB physical memory; no hard memory partition promised",
    );
    check(
        "disk",
        host.freeDiskBytes >= 1024 ** 3,
        "Requires at least1GiB free for local state; model must already be installed",
    );
    check(
        "exposure",
        true,
        "Dedicated supervised runtime binds explicit127.0.0.1 endpoint; no network provider API",
    );
    if (!checks.every((c) => c.passed))
        return capabilityReportSchema.parse(report);
    try {
        await runtime.start();
        const info = await runtime.info();
        report.model.digest = /^(sha256:)?[a-f0-9]{64}$/.test(info.digest)
            ? info.digest
            : null;
        report.model.runtimeVersion = /^\d+\.\d+\.\d+$/.test(info.version)
            ? info.version
            : null;
        check(
            "runtime",
            info.version === config.expectedRuntimeVersion,
            "Runtime version must equal explicitly approved version",
        );
        check(
            "model",
            info.digest === config.expectedDigest,
            "Local approved model digest must equal configured pin; no automatic pulls",
        );
        if (!checks.every((c) => c.passed)) {
            await runtime.stop();
            return capabilityReportSchema.parse(report);
        }
        const cold = await runtime.generate(
            "Reply with the word hello.",
            8,
            AbortSignal.timeout(60000),
        );
        const warm = await runtime.generate(
            "Reply with the word ready.",
            8,
            AbortSignal.timeout(60000),
        );
        check(
            "inference",
            !!cold.text.trim() && !!warm.text.trim(),
            "Cold load and warm bounded raw text generation succeeded",
        );
        report.benchmark = {
            warmLatencyMs: warm.durationMs,
            tokensPerSecond: warm.outputTokens / (warm.durationMs / 1000 || 1),
        };
        check(
            "limits",
            warm.outputTokens <= 8 &&
                cold.outputTokens <= 8 &&
                warm.inputTokens <= 2048,
            "Runtime applied output and context profile; conservative UTF8 byte admission reserves output context",
        );
        check(
            "cancellation",
            await runtime.cancellationCheck(),
            "Abort generation and terminate owned runtime group, restart before admission",
        );
        if (checks.every((c) => c.passed)) report.state = "testing";
    } catch {
        check(
            "inference",
            false,
            "Runtime check failed; inspect explicit binary, installed model, digest/version, and generation support",
        );
        await runtime.stop();
    }
    // Set after tests so a connectivity proof must be newer than this report.
    report.testedAt = new Date(now()).toISOString();
    return capabilityReportSchema.parse(report);
}
