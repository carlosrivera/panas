import { spawn } from "node:child_process";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { repositoryRoot, childEnvironment } from "./processes.js";
import { evidenceSchema, type CaseEvidence } from "./evidence.js";
import { execFileSync } from "node:child_process";
import { privateDirectory } from "./config.js";

/** Reuses owning-package failure checks; it does not relabel injected evidence as cloud/hardware proof. */
export async function runFailureFixtures(outputDir: string): Promise<string> {
    await privateDirectory(outputDir);
    const startedAt = new Date().toISOString(),
        raw = join(outputDir, "fixture-results.private.json");
    const files = [
        "apps/provider/src/provider.test.ts",
        "apps/provider-mcp/src/service.test.ts",
        "apps/provider-mcp/src/accounting-client.test.ts",
        "apps/buyer-mcp/src/service.test.ts",
        "apps/buyer-mcp/src/clients.test.ts",
    ];
    const child = spawn(
        "pnpm",
        [
            "exec",
            "vitest",
            "run",
            ...files,
            "--reporter=json",
            `--outputFile=${raw}`,
        ],
        {
            cwd: repositoryRoot,
            env: childEnvironment(),
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    child.stdout.resume();
    child.stderr.resume();
    const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", () =>
            reject(new Error("FIXTURE_RUNNER_UNAVAILABLE")),
        );
        child.once("exit", resolve);
    });
    await chmod(raw, 0o600);
    const results = JSON.parse(await readFile(raw, "utf8")) as {
        success?: boolean;
        testResults?: {
            assertionResults?: { fullName?: string; status?: string }[];
        }[];
    };
    const assertions =
        results.testResults?.flatMap((t) => t.assertionResults ?? []) ?? [];
    const names = assertions
        .filter((t) => t.status === "passed")
        .map((t) => t.fullName ?? "");
    const groups: [string, string[]][] = [
        [
            "ticket-and-authorization-tamper",
            [
                "rejects ticket-only, wrong platform, wrong buyer, altered payload, stale startup and wrong provider",
                "rejects expiry, operation substitution, model change, limit overflow, and proof replay durably",
            ],
        ],
        [
            "nonce-replay-and-reconnect",
            [
                "rejects expiry, operation substitution, model change, limit overflow, and proof replay durably",
                "survives adapter death without losing paid request state and exposes no resource/prompt bypass",
            ],
        ],
        [
            "queue-overflow",
            [
                "declines a full queue without overwriting another accepted request",
            ],
        ],
        [
            "cancel-before-completion",
            [
                "signs durable cancellation but never releases accounting directly",
            ],
        ],
        [
            "deadline",
            [
                "fails timed-out work and never leaves the worker available",
                "includes metadata inspection within the execution deadline",
            ],
        ],
        [
            "unknown-recovery",
            [
                "marks interrupted requests unknown instead of executing them again",
            ],
        ],
        [
            "wake-gap-invalidation",
            ["invalidates readiness after runtime change and wake gap"],
        ],
        [
            "terminal-delivery-client-outage",
            [
                "retains a signed terminal outbox across adapter/service loss and retries idempotently",
            ],
        ],
        [
            "no-automatic-replay",
            [
                "does not replay inference after lost response or facade restart; refreshes retrieval after execution expiry",
            ],
        ],
    ];
    const cases: CaseEvidence[] = groups.map(([id, required]) => {
        const matched = required
            .map((ending) => names.find((name) => name.endsWith(ending)))
            .filter((name): name is string => name !== undefined);
        return {
            id,
            status: matched.length === required.length ? "passed" : "not_run",
            source: "component_fixture",
            detail: `Component fixtures only; no end-to-end claim. Exact passing checks: ${matched.join("; ") || "none"}. Required checks: ${required.join("; ")}`,
        };
    });
    cases.push({
        id: "cancel-completion-race-e2e",
        status: "not_run",
        source: "component_fixture",
        detail: "Cancellation-before-completion fixture is not evidence that both actual distributed race outcomes were observed.",
    });
    const report = evidenceSchema.parse({
        version: 1,
        runId: randomUUID(),
        mode: "failure-fixtures",
        startedAt,
        finishedAt: new Date().toISOString(),
        gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repositoryRoot,
            encoding: "utf8",
        }).trim(),
        sourceTreeDirty:
            execFileSync("git", ["status", "--porcelain"], {
                cwd: repositoryRoot,
                encoding: "utf8",
            }).trim().length > 0,
        physicalMachineCount: 0,
        logicalProviderCount: 0,
        caseEvidence: cases,
        gates: {
            twoPhysicalMacs: "pending",
            release9: "pending",
            issue10Complete: false,
        },
        cleanup: {
            ownedProcessesStopped: code === 0,
            runtimePortsClosed: true,
        },
    });
    const path = join(outputDir, `failure-matrix-${report.runId}.json`);
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
        mode: 0o600,
    });
    if (code !== 0 || !results.success)
        throw new Error("FAILURE_FIXTURES_FAILED");
    return path;
}
