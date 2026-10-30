#!/usr/bin/env node
import { readFile, mkdir, lstat, writeFile } from "node:fs/promises";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { launchDockerProvider } from "./docker-provider.js";
import { parseArgs } from "node:util";

const help = `Panas — share bounded inference from an Apple Silicon Mac

panas --version
panas identity init --dir /absolute/private/directory
panas provider --free
panas provider --solana-devnet --price-atomic 10000
panas mcp-config
panas codex-config
panas demo-prompt [--paid]
panas doctor
panas buyer

Default config: ~/.config/panas/provider.env or buyer.env.
Override with --env-file /absolute/private/config.env.
Provider isolation: Docker gateway + offline CPU inference worker. No native fallback.

Requires Node 24. Provider requires macOS 14+ on Apple Silicon and
Docker Desktop and the explicitly installed pinned model. Enrollment is operator-managed.
Buyer speaks MCP on stdio; keep that channel free of ordinary logging.
`;
async function main() {
    if (Number(process.versions.node.split(".")[0]) !== 24)
        throw new Error("Node 24 required");
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: "boolean" },
            version: { type: "boolean" },
            "env-file": { type: "string" },
            dir: { type: "string" },
            free: { type: "boolean" },
            paid: { type: "boolean" },
            "solana-devnet": { type: "boolean" },
            "price-atomic": { type: "string" },
            "sandbox-image": { type: "string" },
        },
    });
    if (values.help || process.argv.length === 2) {
        process.stdout.write(help);
        return;
    }
    if (values.version) {
        process.stdout.write(
            await readFile(new URL("../release.json", import.meta.url), "utf8"),
        );
        return;
    }
    const [command, action, ...extra] = positionals;
    if (
        values["sandbox-image"] &&
        !["provider", "doctor"].includes(command ?? "")
    )
        throw new Error("Sandbox image is provider-only");
    if (values.paid && command !== "demo-prompt")
        throw new Error("--paid selects the paid demo prompt");
    if (
        (values.free || values["solana-devnet"] || values["price-atomic"]) &&
        (command !== "provider" ||
            (values.free &&
                (values["solana-devnet"] || values["price-atomic"])))
    )
        throw new Error(
            "Pricing flags are provider-only and mutually exclusive",
        );
    if (
        command === "demo-prompt" &&
        !action &&
        !values.dir &&
        !values["env-file"]
    ) {
        process.stdout.write(
            await readFile(
                new URL(
                    values.paid
                        ? "../demo-paid-prompt.md"
                        : "../demo-prompt.md",
                    import.meta.url,
                ),
                "utf8",
            ),
        );
        return;
    }
    if (
        command === "identity" &&
        action === "init" &&
        !extra.length &&
        values.dir &&
        !values["env-file"]
    ) {
        const dir = resolve(values.dir);
        // Dedicated new directory prevents overwrites and partially replacing an identity.
        await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
        await mkdir(dir, { mode: 0o700 });
        const info = await lstat(dir);
        if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
            throw new Error("Private directory required");
        const keys = generateKeyPairSync("ed25519");
        const providerId = randomUUID();
        await writeFile(
            join(dir, "provider.pem"),
            keys.privateKey.export({ type: "pkcs8", format: "pem" }),
            { mode: 0o600, flag: "wx" },
        );
        await writeFile(
            join(dir, "provider-public.pem"),
            keys.publicKey.export({ type: "spki", format: "pem" }),
            { mode: 0o600, flag: "wx" },
        );
        await writeFile(join(dir, "provider-id"), providerId + "\n", {
            mode: 0o600,
            flag: "wx",
        });
        process.stdout.write(
            JSON.stringify({
                providerId,
                publicKeyFile: join(dir, "provider-public.pem"),
            }) + "\n",
        );
        return;
    }
    if (
        !command ||
        action ||
        extra.length ||
        values.dir ||
        !["provider", "doctor", "buyer", "mcp-config", "codex-config"].includes(
            command,
        )
    )
        throw new Error("Invalid command");
    const envPath = resolve(
        values["env-file"] ??
            join(
                homedir(),
                ".config/panas",
                command === "buyer" ||
                    command === "mcp-config" ||
                    command === "codex-config"
                    ? "buyer.env"
                    : "provider.env",
            ),
    );
    {
        const path = envPath;
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
            throw new Error("Private env file required");
        process.loadEnvFile(path);
    }
    if (command === "codex-config") {
        process.stdout.write(
            `[mcp_servers.panas]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([fileURLToPath(import.meta.url), "buyer", "--env-file", envPath])}\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\n`,
        );
        return;
    }
    if (command === "mcp-config") {
        process.stdout.write(
            JSON.stringify(
                {
                    mcpServers: {
                        panas: {
                            command: process.execPath,
                            args: [
                                fileURLToPath(import.meta.url),
                                "buyer",
                                "--env-file",
                                envPath,
                            ],
                        },
                    },
                },
                null,
                2,
            ) + "\n",
        );
        return;
    }
    if (
        command !== "buyer" &&
        (process.platform !== "darwin" || process.arch !== "arm64")
    )
        throw new Error("Provider requires an Apple Silicon Mac");
    const modules: Record<string, string> = {
        provider: "../apps/provider-mcp/src/host.js",
        doctor: "../apps/provider/src/doctor.js",
        buyer: "../apps/buyer-mcp/src/cli.js",
    };
    if (command === "provider" && values.free) {
        process.env.PANAS_PRICE_ATOMIC = "0";
        process.env.PANAS_PRICE_CURRENCY = "TEST_CREDIT";
        process.env.PANAS_PRICE_VERSION = "free-v1";
    }
    if (command === "provider" && values["solana-devnet"]) {
        const amount = values["price-atomic"];
        if (!amount || !/^[1-9][0-9]{0,29}$/.test(amount))
            throw new Error("Set a positive atomic devnet-USDC price");
        process.env.PANAS_PRICE_ATOMIC = amount;
        process.env.PANAS_PRICE_CURRENCY = "SOLANA_DEVNET_USDC";
        process.env.PANAS_PRICE_VERSION = `devnet-usdc-${amount}`;
    } else if (values["price-atomic"])
        throw new Error("Choose --solana-devnet for this price");
    if (command === "provider" || command === "doctor") {
        await launchDockerProvider(command, values["sandbox-image"]);
        return;
    }
    await import(new URL(modules[command]!, import.meta.url).href);
}
void main().catch(() => {
    // Configuration/crypto exceptions can contain private material. Never print them.
    process.stderr.write(
        "Panas could not start. Use --help; verify Node 24, supported hardware, owner-only configuration, and a new identity directory.\n",
    );
    process.exitCode = 1;
});
