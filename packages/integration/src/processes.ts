import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { parseEnv } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivate } from "./config.js";
import { retainPrivateDiagnostics } from "./private-log.js";
import { dirname } from "node:path";
import { callDaemon } from "../../../apps/provider-mcp/src/ipc-client.js";

export const repositoryRoot = fileURLToPath(
    new URL("../../../", import.meta.url),
);
export function childEnvironment(additions: Record<string, string> = {}) {
    return {
        ...Object.fromEntries(
            ["PATH", "HOME", "TMPDIR", "NODE_EXTRA_CA_CERTS"].flatMap((key) =>
                process.env[key] === undefined
                    ? []
                    : [[key, process.env[key]!]],
            ),
        ),
        ...additions,
    };
}
export async function portClosed(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.on("connect", () => {
            socket.destroy();
            resolve(false);
        });
        socket.on("error", () => {
            socket.destroy();
            resolve(true);
        });
        socket.setTimeout(1000, () => {
            socket.destroy();
            resolve(false);
        });
    });
}
export interface OwnedProvider {
    child: ChildProcess;
    env: Record<string, string>;
    stopped: boolean;
}
export async function launchProvider(
    envPath: string,
    overrides: Record<string, string> = {},
): Promise<OwnedProvider> {
    const env = {
        ...Object.fromEntries(
            Object.entries(parseEnv(await readPrivate(envPath))).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
            ),
        ),
        ...overrides,
    };
    const endpoint = new URL(env.PANAS_OLLAMA_ENDPOINT ?? "");
    if (
        endpoint.hostname !== "127.0.0.1" ||
        !["11601", "11602"].includes(endpoint.port) ||
        !(await portClosed(Number(endpoint.port)))
    )
        throw new Error("DEDICATED_PORT_NOT_AVAILABLE");
    const child = spawn(
        process.execPath,
        [
            "--import",
            "tsx",
            join(repositoryRoot, "apps/provider-mcp/src/host.ts"),
        ],
        {
            cwd: repositoryRoot,
            env: childEnvironment(env),
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    const closeLogs = retainPrivateDiagnostics(dirname(envPath), "provider", [
        child.stdout,
        child.stderr,
    ]);
    child.once("close", closeLogs);
    child.on("error", () => {});
    return { child, env, stopped: false };
}
export async function localAdmin(provider: OwnedProvider, method: string) {
    const dir = provider.env.PANAS_DATA_PATH;
    if (!dir) throw new Error("PROVIDER_DATA_PATH_MISSING");
    return callDaemon(join(dir, "daemon.sock"), join(dir, "ipc-token"), method);
}
export async function stopProvider(provider: OwnedProvider): Promise<void> {
    if (provider.stopped) return;
    provider.stopped = true;
    const child = provider.child;
    if (!child.pid) return;
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, 15000);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    if (child.exitCode === null && child.signalCode === null) {
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    }
}
