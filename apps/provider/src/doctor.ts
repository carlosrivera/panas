import { arch, platform, totalmem } from "node:os";
import { randomUUID } from "node:crypto";
import { localReportSchema, type LocalReport } from "@panas/contracts";

const model = "qwen2.5:0.5b";
const checks: LocalReport["checks"] = [];
checks.push({
    name: "platform",
    passed: platform() === "darwin" && arch() === "arm64",
    detail: `${platform()}/${arch()}; prototype requires Apple Silicon macOS`,
});
try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
        throw new Error(`Ollama returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    const installed =
        typeof body === "object" &&
        body !== null &&
        "models" in body &&
        Array.isArray(body.models) &&
        body.models.some(
            (entry: unknown) =>
                typeof entry === "object" &&
                entry !== null &&
                "name" in entry &&
                entry.name === model,
        );
    checks.push({
        name: "model-installed",
        passed: installed,
        detail: installed
            ? `${model} found; digest pin and smoke inference remain required`
            : `Install ${model} explicitly before launching`,
    });
} catch {
    checks.push({
        name: "ollama",
        passed: false,
        detail: "Cannot reach local Ollama at 127.0.0.1:11434 within 5 seconds",
    });
}
checks.push({
    name: "full-capability-suite",
    passed: false,
    detail: "Foundation diagnostic only: model digest, inference, cancellation, memory, and separate-peer probe are not implemented. Provider stays unavailable.",
});
const report = localReportSchema.parse({
    schemaVersion: 1,
    startupId: randomUUID(),
    testedAt: new Date().toISOString(),
    state: "unhealthy",
    platform: platform(),
    architecture: arch(),
    memoryBytes: totalmem(),
    model,
    checks,
});
console.log(JSON.stringify(report, null, 2));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
