// A detached process group must outlive its native child, but never its host.
// The IPC channel closes even when the host receives SIGKILL.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
let child;
let stopping = false;
function signalGroup(signal) {
    try {
        process.kill(-process.pid, signal);
    } catch (error) {
        if (error.code !== "ESRCH") throw error;
    }
}
async function stop() {
    if (stopping) return;
    stopping = true;
    signalGroup("SIGTERM");
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        const force = setTimeout(() => {
            child.kill("SIGKILL");
        }, 250);
        await Promise.race([exited, delay(400)]);
        clearTimeout(force);
    }
    // Also terminate any runner descendants that outlived the native leader.
    signalGroup("SIGKILL");
}
process.on("SIGTERM", () => {
    void stop();
});
process.on("SIGINT", () => {
    void stop();
});
process.once("disconnect", () => {
    void stop();
});
if (!process.connected || !process.argv[2]) process.exit(1);
const env = { ...process.env };
delete env.NODE_CHANNEL_FD;
delete env.NODE_CHANNEL_SERIALIZATION_MODE;
child = spawn(process.argv[2], process.argv.slice(3), {
    detached: false,
    stdio: ["inherit", "inherit", "inherit"],
    env,
});
function reportExit(message) {
    if (!process.connected) {
        void stop();
        return;
    }
    try {
        process.send(message, () => {
            void stop();
        });
    } catch {
        void stop();
    }
}
child.once("error", () => reportExit({ kind: "spawn_failed" }));
child.once("exit", (code, signal) =>
    reportExit({ kind: "child_exit", code, signal }),
);
