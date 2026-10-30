import { it, expect } from "vitest";
import { sandboxArgs, verifySandboxInspect } from "./docker-provider";
import { containerLimits } from "../../provider/src/container-profile";
function fixture(role: "worker" | "gateway") {
    const limits = containerLimits[role],
        id = "fixture",
        prefix = "panas-fixture";
    return {
        Id: "sha256:image",
        Image: "sha256:image",
        Config: {
            User: "10001:10001",
            Env: ["HOME=/tmp"],
            Labels: { "io.panas.provider": id, "io.panas.role": role },
        },
        HostConfig: {
            Privileged: false,
            ReadonlyRootfs: true,
            Memory: Number(limits.memory),
            MemorySwap: Number(limits.memory),
            NanoCpus: limits.cpus * 1e9,
            PidsLimit: Number(limits.pids),
            NetworkMode: role === "worker" ? "none" : "bridge",
            PidMode: "",
            IpcMode: "private",
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges=true"],
            Tmpfs: {
                "/tmp": "rw,noexec,size=67108864",
                "/run/panas": "rw,noexec,size=1048576",
            },
        },
        Mounts: [
            {
                Type: "volume",
                Name: `${prefix}-ipc`,
                Destination: "/ipc",
                RW: role === "worker",
            },
            role === "worker"
                ? { Type: "bind", Name: "", Destination: "/models", RW: false }
                : {
                      Type: "volume",
                      Name: `${prefix}-state`,
                      Destination: "/state",
                      RW: true,
                  },
        ],
    };
}
it.each(["worker", "gateway"] as const)(
    "rejects weakened %s containment before startup",
    (role) => {
        const valid = fixture(role);
        expect(() =>
            verifySandboxInspect(valid, role, "fixture", "sha256:image"),
        ).not.toThrow();
        for (const mutate of [
            (v: typeof valid) => {
                v.HostConfig.Privileged = true;
            },
            (v: typeof valid) => {
                v.HostConfig.ReadonlyRootfs = false;
            },
            (v: typeof valid) => {
                v.HostConfig.Memory = 0;
            },
            (v: typeof valid) => {
                v.HostConfig.PidsLimit = -1;
            },
            (v: typeof valid) => {
                v.HostConfig.NetworkMode = "host";
            },
            (v: typeof valid) => {
                v.HostConfig.SecurityOpt = ["seccomp=unconfined"];
            },
            (v: typeof valid) => {
                v.Config.User = "0";
            },
            (v: typeof valid) => {
                v.Mounts.push({
                    Type: "bind",
                    Name: "",
                    Destination: "/var/run/docker.sock",
                    RW: false,
                });
            },
            (v: typeof valid) => {
                v.Mounts.push({
                    Type: "bind",
                    Name: "",
                    Destination: "/home/owner",
                    RW: false,
                });
            },
            (v: typeof valid) => {
                v.Config.Env.push("PANAS_PROVIDER_PRIVATE_KEY=secret");
            },
        ]) {
            const invalid = structuredClone(valid);
            mutate(invalid);
            expect(() =>
                verifySandboxInspect(invalid, role, "fixture", "sha256:image"),
            ).toThrow();
        }
        expect(() =>
            verifySandboxInspect(valid, role, "other", "sha256:image"),
        ).toThrow();
        const args = sandboxArgs(
            role,
            "fixture",
            "sha256:image",
            "/models-source",
        );
        expect(args).not.toContain("--privileged");
        expect(args).not.toContain("--publish");
    },
);
