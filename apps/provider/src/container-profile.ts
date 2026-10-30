import { readFile, access, statfs } from "node:fs/promises";
export type ContainerRole = "gateway" | "worker";
export const containerLimits = {
    gateway: { memory: 1073741824, pids: 256, cpus: 1 },
    worker: { memory: 4294967296, pids: 256, cpus: 2 },
} as const;
export async function assertContainerProfile(role: ContainerRole) {
    if (process.platform !== "linux" || process.getuid?.() !== 10001)
        throw new Error("Docker non-root profile required");
    await access("/.dockerenv");
    const status = await readFile("/proc/self/status", "utf8");
    for (const [name, value] of [
        ["CapEff", "0000000000000000"],
        ["CapPrm", "0000000000000000"],
        ["CapBnd", "0000000000000000"],
        ["NoNewPrivs", "1"],
        ["Seccomp", "2"],
    ])
        if (
            !status.split("\n").some((line) => {
                const colon = line.indexOf(":");
                return (
                    line.slice(0, colon) === name &&
                    line.slice(colon + 1).trim() === value
                );
            })
        )
            throw new Error("Container privilege profile rejected");
    const mounts = await readFile("/proc/self/mountinfo", "utf8");
    if (
        !mounts.split("\n").some((line) => {
            const f = line.split(" ");
            return f[4] === "/" && f[5]?.split(",").includes("ro");
        })
    )
        throw new Error("Read-only container root required");
    const ipc = await statfs("/ipc");
    if (ipc.type !== 0x01021994 || ipc.blocks * ipc.bsize > 1048576)
        throw new Error("Bounded IPC tmpfs required");
    const limit = containerLimits[role];
    const memory = Number(
        (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim(),
    );
    const pids = Number(
        (await readFile("/sys/fs/cgroup/pids.max", "utf8")).trim(),
    );
    const [quota, period] = (await readFile("/sys/fs/cgroup/cpu.max", "utf8"))
        .trim()
        .split(" ")
        .map(Number);
    if (
        !Number.isFinite(memory) ||
        memory > limit.memory ||
        memory <= 0 ||
        !Number.isFinite(pids) ||
        pids > limit.pids ||
        pids <= 0 ||
        !quota ||
        !period ||
        quota / period > limit.cpus
    )
        throw new Error("Container resource bounds required");
    await access("/var/run/docker.sock").then(
        () => {
            throw new Error("Docker socket must not enter containers");
        },
        () => {},
    );
    if (role === "worker") {
        const network = await readFile("/proc/net/route", "utf8");
        if (network.trim().split("\n").length !== 1)
            throw new Error("Worker network must be disabled");
    }
    return {
        kind: "docker" as const,
        role,
        memory,
        pids,
        cpus: quota / period,
    };
}
