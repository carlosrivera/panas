import { writeFile, mkdir } from "node:fs/promises";
import { assertContainerProfile } from "../../provider/src/container-profile.js";
await assertContainerProfile("gateway");
await mkdir("/run/panas", { recursive: true, mode: 0o700 });
let last = Date.now(),
    buffer = "",
    loaded = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
    last = Date.now();
    buffer += chunk;
    if (buffer.length > 65536) process.exit(1);
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (loaded) return;
    loaded = true;
    void (async () => {
        const config = JSON.parse(line) as {
            env: Record<string, string>;
            privateKey: string;
            platformPublicKey: string;
            command: string;
        };
        const allowed = [
            "PANAS_PROVIDER_ID",
            "PANAS_PEER_ADDRESSES",
            "PANAS_MODEL_DIGEST",
            "PANAS_OLLAMA_VERSION",
            "PANAS_REGISTRY_URL",
            "PANAS_ACCOUNTING_URL",
            "PANAS_PRICE_VERSION",
            "PANAS_PRICE_ATOMIC",
            "PANAS_PRICE_CURRENCY",
        ];
        for (const name of allowed) {
            const value = config.env[name];
            if (value !== undefined) process.env[name] = value;
        }
        await writeFile("/run/panas/provider.pem", config.privateKey, {
            mode: 0o600,
        });
        await writeFile("/run/panas/platform.pem", config.platformPublicKey, {
            mode: 0o600,
        });
        Object.assign(process.env, {
            PANAS_DATA_PATH: "/state",
            PANAS_MODELS_PATH: "/models",
            PANAS_OLLAMA_BINARY: "/usr/bin/ollama",
            PANAS_OLLAMA_ENDPOINT: "http://127.0.0.1:11536",
            PANAS_PROVIDER_PRIVATE_KEY_PATH: "/run/panas/provider.pem",
            PANAS_PLATFORM_PUBLIC_KEY_PATH: "/run/panas/platform.pem",
        });
        if (config.command !== "provider" && config.command !== "doctor")
            throw new Error("Invalid entry");
        await import(
            new URL(
                config.command === "provider"
                    ? "../../provider-mcp/src/host.js"
                    : "../../provider/src/doctor.js",
                import.meta.url,
            ).href
        );
        if (config.command === "doctor") process.exit(process.exitCode ?? 0);
    })().catch(() => {
        console.error("Container startup rejected");
        process.exit(1);
    });
});
// The Mac launcher sends a lease heartbeat. Losing it closes admission, even after SIGKILL/sleep.
setInterval(() => {
    if (Date.now() - last > 20000) {
        process.kill(process.pid, "SIGTERM");
        setTimeout(() => process.exit(1), 5000).unref();
    }
}, 1000).unref();
process.stdin.on("end", () => {
    process.kill(process.pid, "SIGTERM");
});

process.once("SIGTERM", () => {
    process.stdin.pause();
    setTimeout(() => process.exit(1), 8000).unref();
});
