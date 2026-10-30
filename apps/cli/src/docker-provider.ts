import { withReleaseImage } from "./sandbox-image.js";
import { stageApprovedModel } from "./model-stage.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat, realpath } from "node:fs/promises";
import { containerLimits } from "../../provider/src/container-profile.js";
interface DockerInfo {
    Id: string;
    Image: string;
    Config: { Labels?: Record<string, string>; User: string; Env: string[] };
    HostConfig: {
        Privileged: boolean;
        ReadonlyRootfs: boolean;
        Memory: number;
        MemorySwap: number;
        NanoCpus: number;
        PidsLimit: number;
        NetworkMode: string;
        PidMode: string;
        IpcMode: string;
        CapAdd?: string[];
        CapDrop: string[];
        SecurityOpt: string[];
        PortBindings?: Record<string, unknown>;
        Devices?: unknown[];
        DeviceRequests?: unknown[];
        VolumesFrom?: unknown[];
        Binds?: unknown[];
        Tmpfs?: Record<string, string>;
    };
    Mounts?: {
        Type: string;
        Destination: string;
        Name?: string;
        RW: boolean;
    }[];
    State?: { Running: boolean };
}
const exec = promisify(execFile);
const docker = async (args: string[], timeout = 20000) =>
    (
        await exec("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024 })
    ).stdout.trim();
const ownedLabel = "io.panas.provider";
export function sandboxArgs(
    role: "gateway" | "worker",
    providerId: string,
    image: string,
    modelsPath: string,
) {
    const prefix = `panas-${providerId}`,
        limits = containerLimits[role];
    const args = [
        "create",
        "--name",
        `${prefix}-${role}`,
        "--label",
        `${ownedLabel}=${providerId}`,
        "--label",
        `io.panas.role=${role}`,
        "--init",
        "--read-only",
        "--user",
        "10001:10001",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--memory",
        String(limits.memory),
        "--memory-swap",
        String(limits.memory),
        "--cpus",
        String(limits.cpus),
        "--pids-limit",
        String(limits.pids),
        "--ulimit",
        "nofile=1024:1024",
        "--log-driver",
        "local",
        "--log-opt",
        "max-size=10m",
        "--log-opt",
        "max-file=2",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=700",
        "--network",
        role === "worker" ? "none" : "bridge",
    ];
    args.push(
        "--mount",
        `type=volume,source=${prefix}-ipc,target=/ipc${role === "gateway" ? ",readonly" : ""}`,
    );
    if (role === "worker")
        args.push(
            "--mount",
            `type=bind,source=${modelsPath},target=/models,readonly`,
            "--entrypoint",
            "node",
            image,
            "/opt/panas/apps/provider/src/worker.js",
        );
    else
        args.push(
            "--interactive",
            "--tmpfs",
            "/run/panas:rw,noexec,nosuid,nodev,size=1048576,uid=10001,gid=10001,mode=700",
            "--mount",
            `type=volume,source=${prefix}-state,target=/state`,
            image,
        );
    return args;
}
export function verifySandboxInspect(
    value: DockerInfo,
    role: "gateway" | "worker",
    providerId: string,
    imageId: string,
) {
    const h = value.HostConfig,
        c = value.Config,
        l = containerLimits[role],
        mounts = value.Mounts ?? [];
    const prefix = `panas-${providerId}`;
    const expected =
        role === "worker"
            ? ["/ipc", "/models"]
            : ["/ipc", "/state", "/run/panas"];
    // tmpfs mounts are also checked against the explicit launcher configuration below.
    if (
        c.Labels?.[ownedLabel] !== providerId ||
        c.Labels?.["io.panas.role"] !== role ||
        value.Image !== imageId ||
        c.User !== "10001:10001" ||
        h.Privileged ||
        !h.ReadonlyRootfs ||
        h.Memory !== l.memory ||
        h.MemorySwap !== l.memory ||
        h.NanoCpus !== l.cpus * 1e9 ||
        h.PidsLimit !== l.pids ||
        h.NetworkMode !== (role === "worker" ? "none" : "bridge") ||
        h.PidMode ||
        h.IpcMode !== "private" ||
        h.CapAdd?.length ||
        h.CapDrop?.length !== 1 ||
        h.CapDrop[0]?.toUpperCase() !== "ALL" ||
        !h.SecurityOpt?.includes("no-new-privileges=true") ||
        h.SecurityOpt.some((v: string) => v !== "no-new-privileges=true") ||
        Object.keys(h.PortBindings ?? {}).length ||
        h.Devices?.length ||
        h.DeviceRequests?.length ||
        h.VolumesFrom?.length ||
        h.Binds?.length ||
        c.Env.some(
            (v: string) => v.startsWith("PANAS_") || v.startsWith("DOCKER_"),
        )
    )
        throw new Error("Docker confinement inspection rejected");
    for (const m of mounts) {
        if (
            m.Type === "tmpfs" &&
            ["/tmp", "/run/panas"].includes(m.Destination)
        )
            continue;
        if (
            !expected.includes(m.Destination) ||
            (m.Destination === "/models" && (m.Type !== "bind" || m.RW)) ||
            (m.Destination === "/ipc" &&
                (m.Type !== "volume" ||
                    m.Name !== `${prefix}-ipc` ||
                    m.RW !== (role === "worker"))) ||
            (m.Destination === "/state" &&
                (m.Type !== "volume" || m.Name !== `${prefix}-state` || !m.RW))
        )
            throw new Error("Unexpected sandbox mount");
    }
    const required =
        role === "worker" ? ["/ipc", "/models"] : ["/ipc", "/state"];
    if (
        required.some(
            (dest) =>
                !mounts.some(
                    (m: Record<string, unknown>) => m.Destination === dest,
                ),
        )
    )
        throw new Error("Missing sandbox mount");
    if (
        !h.Tmpfs?.["/tmp"]?.includes("noexec") ||
        (role === "gateway" && !h.Tmpfs?.["/run/panas"]?.includes("noexec"))
    )
        throw new Error("Bounded temporary filesystems required");
}
export async function prepareIpcVolume(providerId: string) {
    const name = `panas-${providerId}-ipc`;
    await docker([
        "volume",
        "create",
        "--label",
        `${ownedLabel}=${providerId}`,
        "--driver",
        "local",
        "--opt",
        "type=tmpfs",
        "--opt",
        "device=tmpfs",
        "--opt",
        "o=size=1048576,uid=10001,gid=10001,mode=0700,nosuid,nodev,noexec",
        name,
    ]);
    const volume = JSON.parse(await docker(["volume", "inspect", name]))[0];
    if (
        volume.Labels?.[ownedLabel] !== providerId ||
        volume.Driver !== "local" ||
        volume.Options?.type !== "tmpfs" ||
        volume.Options?.device !== "tmpfs" ||
        volume.Options?.o !==
            "size=1048576,uid=10001,gid=10001,mode=0700,nosuid,nodev,noexec"
    )
        throw new Error("Bounded private IPC volume required");
}
export async function launchDockerProvider(
    command: "provider" | "doctor",
    imageOverride?: string,
) {
    const release = JSON.parse(
        await readFile(new URL("../release.json", import.meta.url), "utf8"),
    );
    const providerId = process.env.PANAS_PROVIDER_ID ?? "";
    if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            providerId,
        )
    )
        throw new Error("Provider identity required");
    if (
        process.env.DOCKER_HOST &&
        !process.env.DOCKER_HOST.startsWith("unix://")
    )
        throw new Error("Local Docker daemon required");
    const context = JSON.parse(await docker(["context", "inspect"]));
    if (!context[0]?.Endpoints?.docker?.Host?.startsWith("unix://"))
        throw new Error("Local Docker context required");
    const server = JSON.parse(await docker(["info", "--format", "{{json .}}"]));
    if (
        server.OSType !== "linux" ||
        !["aarch64", "arm64"].includes(server.Architecture)
    )
        throw new Error("ARM64 Linux Docker required");
    const image = imageOverride ?? `panas-provider:${release.version}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/:@._-]*$/.test(image))
        throw new Error("Invalid sandbox image");
    let details: DockerInfo;
    try {
        details = JSON.parse(await docker(["image", "inspect", image]))[0];
    } catch {
        if (imageOverride)
            throw new Error("Build the specified development image first");
        process.stderr.write(
            "Downloading and verifying the matching Panas sandbox image…\n",
        );
        await withReleaseImage(release.version, (path) =>
            docker(["load", "--input", path], 300000),
        );
        details = JSON.parse(await docker(["image", "inspect", image]))[0];
    }
    if (
        details.Config.Labels?.["org.opencontainers.image.revision"] !==
            release.sourceCommit ||
        details.Config.Labels?.["io.panas.source-dirty"] !==
            String(release.sourceDirty)
    )
        throw new Error("Sandbox image must match this CLI build");
    const imageId = details.Id;
    const modelsPath = await realpath(process.env.PANAS_MODELS_PATH ?? "");
    if (
        modelsPath.includes(",") ||
        !(await lstat(process.env.PANAS_MODELS_PATH!)).isDirectory()
    )
        throw new Error("Dedicated real model directory required");
    const prefix = `panas-${providerId}`;
    async function inspect(name: string) {
        try {
            return JSON.parse(await docker(["inspect", name]))[0];
        } catch {
            return undefined;
        }
    }
    const oldGateway = await inspect(`${prefix}-gateway`);
    if (oldGateway?.State?.Running)
        throw new Error("Provider sandbox already running");
    for (const role of ["gateway", "worker"]) {
        const name = `${prefix}-${role}`,
            old = await inspect(name);
        if (old) {
            if (
                old.Config.Labels?.[ownedLabel] !== providerId ||
                old.Config.Labels?.["io.panas.role"] !== role
            )
                throw new Error("Refusing to replace an unowned container");
            await docker(["rm", "--force", name]);
        }
    }
    const model = await stageApprovedModel(
        modelsPath,
        process.env.PANAS_MODEL_DIGEST ?? "",
    );
    let closed = false;
    const created: string[] = [];
    const cleanup = async () => {
        if (closed) return;
        closed = true;
        for (const name of [...created].reverse()) {
            await docker(["stop", "--time", "10", name], 20000).catch(() => {});
            await docker(["rm", "--force", name]).catch(() => {});
        }
    };
    const signal = () => {
        void cleanup();
    };
    process.once("SIGINT", signal);
    process.once("SIGTERM", signal);
    try {
        await prepareIpcVolume(providerId);
        for (const role of ["worker", "gateway"] as const) {
            const name = `${prefix}-${role}`;
            await docker(
                sandboxArgs(role, providerId, imageId, model.modelsPath),
            );
            created.push(name);
            verifySandboxInspect(
                await inspect(name),
                role,
                providerId,
                imageId,
            );
            if (role === "worker") {
                await docker(["start", name]);
                let ready = false;
                for (let i = 0; i < 60; i++) {
                    const row = await inspect(name);
                    if (!row?.State?.Running) throw new Error("Worker exited");
                    try {
                        await docker([
                            "exec",
                            name,
                            "node",
                            "-e",
                            "require('fs').accessSync('/ipc/runtime.sock')",
                        ]);
                        ready = true;
                        break;
                    } catch {
                        await new Promise((r) => setTimeout(r, 250));
                    }
                }
                if (!ready) throw new Error("Worker readiness timed out");
            }
        }
        const env: Record<string, string> = {};
        for (const k of [
            "PANAS_PROVIDER_ID",
            "PANAS_MODEL_DIGEST",
            "PANAS_OLLAMA_VERSION",
            "PANAS_REGISTRY_URL",
            "PANAS_ACCOUNTING_URL",
            "PANAS_PRICE_VERSION",
            "PANAS_PRICE_ATOMIC",
            "PANAS_PRICE_CURRENCY",
        ]) {
            if (process.env[k]) env[k] = process.env[k]!;
        }
        async function privateFile(name: string) {
            const path = process.env[name];
            if (!path) throw new Error("Provider key configuration missing");
            const st = await lstat(path);
            if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077)
                throw new Error("Owner-only key file required");
            return readFile(path, "utf8");
        }
        const config = {
            command,
            env,
            privateKey: await privateFile("PANAS_PROVIDER_PRIVATE_KEY_PATH"),
            platformPublicKey: await privateFile(
                "PANAS_PLATFORM_PUBLIC_KEY_PATH",
            ),
        };
        process.stderr.write(
            "Panas Docker sandbox: isolated gateway + offline CPU inference worker; no host ports, Docker socket or treasury mounts.\n",
        );
        const child = spawn(
            "docker",
            ["start", "--attach", "--interactive", `${prefix}-gateway`],
            { stdio: ["pipe", "inherit", "inherit"] },
        );
        child.stdin.on("error", () => {});
        child.stdin.write(JSON.stringify(config) + "\n");
        const heartbeat = setInterval(() => {
            if (!closed) child.stdin.write("ping\n");
        }, 5000);
        try {
            await new Promise<void>((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", (code) =>
                    code === 0 || closed
                        ? resolve()
                        : reject(new Error("Provider sandbox exited")),
                );
            });
        } finally {
            clearInterval(heartbeat);
            child.stdin.destroy();
        }
    } finally {
        await cleanup();
        await model.cleanup();
        process.off("SIGINT", signal);
        process.off("SIGTERM", signal);
    }
}
