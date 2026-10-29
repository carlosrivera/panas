import { once } from "node:events";
import type { ChildProcess } from "node:child_process";

/** Signal only a group created by this live ChildProcess owner, never a PID read from disk. */
export async function signalOwnedGroup(
    child: ChildProcess,
    signal: NodeJS.Signals,
): Promise<void> {
    if (!child.pid || child.pid <= 1) return;
    try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return;
        if (code === "EPERM") {
            // Darwin can report EPERM for a group whose guarded leader is a zombie,
            // before Node processes SIGCHLD. Confirm exit; never ignore a live-owner denial.
            if (child.exitCode === null && child.signalCode === null) {
                try {
                    await once(child, "exit", {
                        signal: AbortSignal.timeout(100),
                    });
                } catch {
                    /* Bounded confirmation below. */
                }
            }
            if (child.exitCode !== null || child.signalCode !== null) return;
        }
        throw error;
    }
}
