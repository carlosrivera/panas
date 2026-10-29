import {
    mkdir,
    lstat,
    readFile,
    open,
    rename,
    unlink,
    rmdir,
} from "node:fs/promises";
import { createConnection, type NetConnectOpts } from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function listening(options: NetConnectOpts): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const socket = createConnection(options);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
            socket.destroy();
            if (["ECONNREFUSED", "ENOENT"].includes(error.code ?? ""))
                resolve(false);
            else reject(new Error("OWNER_ENDPOINT_PROBE_FAILED"));
        });
        socket.setTimeout(1000, () => {
            socket.destroy();
            reject(new Error("OWNER_ENDPOINT_PROBE_TIMED_OUT"));
        });
    });
}
async function exists(path: string) {
    try {
        return await lstat(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
}
/** A live PID is always refused, including PID reuse. Never kill a recorded PID. */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        return true;
    }
}
/** Serialize stale-owner recovery before any request/key/nonce store is opened. */
export async function claimProviderHost(
    directory: string,
): Promise<{ recovered: boolean }> {
    const guard = join(directory, "host.starting");
    try {
        await mkdir(guard, { mode: 0o700 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new Error("PROVIDER_STARTUP_IN_PROGRESS", { cause: error });
        throw error;
    }
    try {
        const ownerPath = join(directory, "host.owner.json");
        const info = await exists(ownerPath);
        let recovered = false;
        if (info) {
            if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
                throw new Error("INVALID_HOST_OWNER_RECORD");
            let owner: { version?: unknown; pid?: unknown; instance?: unknown };
            try {
                owner = JSON.parse(await readFile(ownerPath, "utf8"));
            } catch {
                throw new Error("INVALID_HOST_OWNER_RECORD");
            }
            if (!owner || typeof owner !== "object")
                throw new Error("INVALID_HOST_OWNER_RECORD");
            if (
                owner.version !== 1 ||
                !Number.isSafeInteger(owner.pid) ||
                Number(owner.pid) <= 1 ||
                typeof owner.instance !== "string"
            )
                throw new Error("INVALID_HOST_OWNER_RECORD");
            if (alive(Number(owner.pid)))
                throw new Error("PROVIDER_HOST_ALREADY_RUNNING");
            recovered = true;
        }
        const socketPath = join(directory, "daemon.sock");
        const socket = await exists(socketPath);
        if (socket) {
            if (!socket.isSocket() || socket.isSymbolicLink())
                throw new Error("UNSAFE_IPC_PATH");
            if (await listening({ path: socketPath }))
                throw new Error("PROVIDER_IPC_ALREADY_RUNNING");
            // Legacy or incomplete owner metadata is not permission to unlink anything.
            if (!recovered)
                throw new Error("UNTRACKED_STALE_IPC_REQUIRES_OWNER_REVIEW");
            const current = await exists(socketPath);
            if (
                current &&
                (current.dev !== socket.dev || current.ino !== socket.ino)
            )
                throw new Error("IPC_PATH_CHANGED_DURING_RECOVERY");
            if (current) await unlink(socketPath);
        }
        const temporary = join(directory, `host.owner.${randomUUID()}.tmp`);
        try {
            const file = await open(temporary, "wx", 0o600);
            try {
                await file.writeFile(
                    JSON.stringify({
                        version: 1,
                        pid: process.pid,
                        instance: randomUUID(),
                    }),
                );
                await file.sync();
            } finally {
                await file.close();
            }
            await rename(temporary, ownerPath);
            const dir = await open(directory, "r");
            try {
                await dir.sync();
            } finally {
                await dir.close();
            }
        } finally {
            await unlink(temporary).catch((error) => {
                if (error.code !== "ENOENT") throw error;
            });
        }
        // Keep this record through shutdown. A successor must observe this PID dead,
        // not merely an early cleanup callback, before accessing the same store.
        return { recovered };
    } finally {
        await rmdir(guard);
    }
}
/** A crashed host's guard gets a short cleanup window; never adopt or signal a listener. */
export async function waitForPreviousRuntime(endpoint: URL): Promise<void> {
    const until = performance.now() + 2000;
    while (
        await listening({ host: "127.0.0.1", port: Number(endpoint.port) })
    ) {
        if (performance.now() >= until)
            throw new Error("PREVIOUS_RUNTIME_STILL_LISTENING");
        await delay(25);
    }
}
