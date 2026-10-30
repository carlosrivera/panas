import {
    capabilityReportSchema,
    requiredCapabilityChecks,
} from "@panas/contracts/provider";
import type { ConsoleModel } from "./console.js";

/** Never retain raw logs, check details, descriptors or arbitrary report fields. */
export function observeProvider(
    model: ConsoleModel,
    value: unknown,
    now = Date.now(),
) {
    const parsed = capabilityReportSchema.safeParse(value);
    if (!parsed.success) return false;
    const report = parsed.data;
    if (report.providerId !== model.options.providerId) return false;
    const ready =
        ["ready", "busy"].includes(report.state) &&
        report.peerProbe.status === "verified" &&
        requiredCapabilityChecks.every(
            (name) =>
                report.checks.filter(
                    (check) => check.name === name && check.passed,
                ).length === 1,
        ) &&
        report.benchmark !== null;
    model.ready = ready;
    model.lastStatusAt = now;
    const phase =
        report.state === "ready" && ready
            ? "Ready to share"
            : report.state === "busy" && ready
              ? "Serving a request"
              : report.state === "draining"
                ? "Waiting for the registry"
                : report.state === "paused"
                  ? "Provider paused"
                  : report.state === "unhealthy"
                    ? "Local checks need attention"
                    : "Testing your provider";
    const passed = requiredCapabilityChecks.filter((name) =>
        report.checks.some((check) => check.name === name && check.passed),
    ).length;
    const detail = `${passed}/${requiredCapabilityChecks.length} local checks passed · peer probe ${report.peerProbe.status}${report.benchmark ? ` · ${Math.round(report.benchmark.warmLatencyMs)} ms warm` : ""}`;
    if (phase !== model.phase) model.progress(phase, detail);
    else {
        model.detail = detail;
        model.update();
    }
    return true;
}
