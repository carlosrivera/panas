import { execFileSync } from "node:child_process";
import type { OwnedProvider } from "./processes.js";

export function assertDescendant(
    pid: number,
    ownerPid: number,
    parentOf: (pid: number) => number,
): void {
    const seen = new Set<number>();
    let current = pid;
    while (Number.isSafeInteger(current) && current > 1 && !seen.has(current)) {
        if (current === ownerPid && pid !== ownerPid) return;
        seen.add(current);
        current = parentOf(current);
    }
    throw new Error("RUNTIME_NOT_OWNED");
}
/** Suspends only the verified listening Ollama descendant, never the host, shell or Mac. */
export function ownedRuntimePid(provider: OwnedProvider): number {
    if (!provider.child.pid || provider.stopped)
        throw new Error("OWNER_NOT_RUNNING");
    const port = new URL(provider.env.PANAS_OLLAMA_ENDPOINT!).port;
    if (!["11601", "11602"].includes(port))
        throw new Error("UNOWNED_RUNTIME_PORT");
    const output = execFileSync(
        "lsof",
        ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"],
        { encoding: "utf8" },
    ).trim();
    if (!/^\d+$/.test(output)) throw new Error("AMBIGUOUS_RUNTIME_PID");
    const pid = Number(output);
    assertDescendant(pid, provider.child.pid, (child) =>
        Number(
            execFileSync("ps", ["-p", String(child), "-o", "ppid="], {
                encoding: "utf8",
            }).trim(),
        ),
    );
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
    }).trim();
    if (command !== `${provider.env.PANAS_OLLAMA_BINARY} serve`)
        throw new Error("RUNTIME_COMMAND_MISMATCH");
    return pid;
}
export function suspendRuntime(provider: OwnedProvider): () => void {
    const pid = ownedRuntimePid(provider);
    process.kill(pid, "SIGSTOP");
    let resumed = false;
    const resume = () => {
        if (resumed) return;
        resumed = true;
        clearTimeout(watchdog);
        try {
            process.kill(pid, "SIGCONT");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    };
    // Even a failed assertion must not leave a stopped model process behind.
    const watchdog = setTimeout(resume, 3000);
    return resume;
}

/** Use only a PID whose live ancestry was captured before stopping this run's host. */
export function stopCapturedRuntime(
    provider: OwnedProvider,
    pid: number,
): void {
    const port = new URL(provider.env.PANAS_OLLAMA_ENDPOINT!).port;
    try {
        const listening = execFileSync(
            "lsof",
            ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"],
            { encoding: "utf8" },
        ).trim();
        if (listening !== String(pid)) return;
        const command = execFileSync(
            "ps",
            ["-p", String(pid), "-o", "command="],
            { encoding: "utf8" },
        ).trim();
        if (command !== `${provider.env.PANAS_OLLAMA_BINARY} serve`)
            throw new Error("RUNTIME_CHANGED_BEFORE_CLEANUP");
        process.kill(pid, "SIGTERM");
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 1
        )
            return;
        throw error;
    }
}
