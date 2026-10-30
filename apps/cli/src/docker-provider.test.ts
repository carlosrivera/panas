import { it, expect } from "vitest";
import {
    reservePeerPort,
    advertisedPeerAddresses,
    sandboxArgs,
    verifySandboxInspect,
} from "./docker-provider";
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
            PortBindings: (role === "gateway"
                ? { "49737/udp": [{ HostIp: "0.0.0.0", HostPort: "49737" }] }
                : {}) as Record<string, unknown>,
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
        if (role === "worker") expect(args).not.toContain("--publish");
    },
);

it("publishes exactly one gateway UDP socket and rejects additional host access", () => {
    const gateway = fixture("gateway");
    const args = sandboxArgs("gateway", "fixture", "sha256:image", "/models");
    expect(args[args.indexOf("--publish") + 1]).toBe("0.0.0.0:49737:49737/udp");
    expect(
        sandboxArgs("worker", "fixture", "sha256:image", "/models"),
    ).not.toContain("--publish");
    for (const bindings of [
        {},
        { "49737/tcp": [{ HostIp: "0.0.0.0", HostPort: "49737" }] },
        {
            "49737/udp": [{ HostIp: "0.0.0.0", HostPort: "49737" }],
            "22/tcp": [{ HostIp: "0.0.0.0", HostPort: "49737" }],
        },
    ]) {
        gateway.HostConfig.PortBindings = bindings;
        expect(() =>
            verifySandboxInspect(gateway, "gateway", "fixture", "sha256:image"),
        ).toThrow();
    }
});

it("advertises owner host interfaces rather than a container address", () => {
    const routes = advertisedPeerAddresses(52000, {
        en0: [
            {
                address: "192.168.1.20",
                family: "IPv4",
                internal: false,
                netmask: "255.255.255.0",
                mac: "00:00:00:00:00:01",
                cidr: "192.168.1.20/24",
            },
        ],
        lo0: [
            {
                address: "127.0.0.1",
                family: "IPv4",
                internal: true,
                netmask: "255.0.0.0",
                mac: "00:00:00:00:00:00",
                cidr: "127.0.0.1/8",
            },
        ],
    });
    expect(routes).toEqual([
        { host: "192.168.1.20", port: 52000 },
        { host: "127.0.0.1", port: 52000 },
    ]);
});

it("reserves a real UDP port until release rather than accepting Docker port zero", async () => {
    const { createSocket } = await import("node:dgram");
    const lease = await reservePeerPort();
    expect(lease.port).toBeGreaterThan(0);
    const other = createSocket("udp4");
    try {
        await expect(
            new Promise<void>((resolve, reject) => {
                other.once("error", reject);
                other.bind(
                    { address: "0.0.0.0", port: lease.port, exclusive: true },
                    resolve,
                );
            }),
        ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
        other.close();
        await lease.release();
        await lease.release();
    }
});
