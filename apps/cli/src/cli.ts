#!/usr/bin/env node
import { readFile, mkdir, lstat, writeFile } from "node:fs/promises";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { launchDockerProvider } from "./docker-provider.js";
import { parseArgs } from "node:util";
import {
    installMcpClient,
    ensureDemoSession,
    prepareDemoConfig,
    SetupError,
} from "./client-setup.js";
import type { DemoClient } from "./console.js";

const help = `Panas — share bounded inference from an Apple Silicon Mac

panas --version
panas identity init --dir /absolute/private/directory
panas provider --free
panas provider --solana-devnet --price-atomic 10000
panas mcp-config
panas codex-config
panas demo-prompt [--paid]
panas demo [--client codex|antigravity] [--plain]
panas setup --client codex|antigravity
panas hello
panas request REQUEST_UUID
panas doctor
panas buyer

Default config: ~/.config/panas/provider.env or buyer.env.
Override with --env-file /absolute/private/config.env.
Provider isolation: Docker gateway + offline CPU inference worker. No native fallback.

Requires Node 24. Provider requires macOS 14+ on Apple Silicon and
Docker Desktop and the explicitly installed pinned model. Free buyer demos enroll automatically. Provider and paid enrollment is operator-managed.
Buyer speaks MCP on stdio; keep that channel free of ordinary logging.
Interactive provider and demo commands open a dashboard. Use --plain for scripts.
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
            plain: { type: "boolean" },
            client: { type: "string" },
        },
    });
    if (values.help || (process.argv.length === 2 && !process.stdin.isTTY)) {
        process.stdout.write(help);
        return;
    }
    if (values.version) {
        process.stdout.write(
            await readFile(new URL("../release.json", import.meta.url), "utf8"),
        );
        return;
    }
    const [requestedCommand, action, ...extra] = positionals;
    const command =
        requestedCommand === "demo" || !requestedCommand
            ? "demo-prompt"
            : requestedCommand;
    if (values.client && !["codex", "antigravity"].includes(values.client))
        throw new SetupError("Choose --client codex or --client antigravity.");
    if (values.client && !["setup", "demo-prompt"].includes(command))
        throw new SetupError("--client applies to setup and demo commands.");
    const client: DemoClient =
        values.client === "antigravity" ? "antigravity" : "codex";
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
        const prompt = await readFile(
            new URL(
                values.paid ? "../demo-paid-prompt.md" : "../demo-prompt.md",
                import.meta.url,
            ),
            "utf8",
        );
        const forClient = (selected: DemoClient) =>
            `This demo is running in ${selected === "codex" ? "Codex" : "Antigravity"}. Use --client ${selected} when configuring Panas.\n\n${prompt}`;
        if (
            !values.paid &&
            !values.plain &&
            process.stdin.isTTY &&
            process.stderr.isTTY &&
            process.env.TERM !== "dumb"
        ) {
            const { ConsoleModel, startConsole } = await import("./console.js");
            const release = JSON.parse(
                await readFile(
                    new URL("../release.json", import.meta.url),
                    "utf8",
                ),
            );
            const model = new ConsoleModel({
                version: release.version,
                mode: "demo",
                prompt: forClient,
            });
            model.client = client;
            await new Promise<void>((resolve) => {
                const screen = startConsole(model, () => {
                    screen.stop();
                    resolve();
                });
            });
        } else
            process.stdout.write(
                values.paid || !values.client ? prompt : forClient(client),
            );
        return;
    }
    if (
        (command === "hello" && !action && !extra.length) ||
        (command === "request" && action && !extra.length)
    ) {
        const { helloWorld } = await import("./hello.js");
        await helloWorld(
            fileURLToPath(import.meta.url),
            command === "request" ? action : undefined,
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
        ![
            "provider",
            "doctor",
            "buyer",
            "mcp-config",
            "codex-config",
            "setup",
        ].includes(command)
    )
        throw new Error("Invalid command");
    const envPath = resolve(
        values["env-file"] ??
            join(
                homedir(),
                ".config/panas",
                command === "buyer" ||
                    command === "mcp-config" ||
                    command === "codex-config" ||
                    command === "setup"
                    ? "buyer.env"
                    : "provider.env",
            ),
    );
    if (command !== "setup") {
        const info = await lstat(envPath).catch(() => {
            throw new SetupError(
                "Panas configuration is missing. Run panas setup --client codex or antigravity for the free demo.",
            );
        });
        if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
            throw new Error("Private env file required");
        process.loadEnvFile(envPath);
    }
    if (command === "buyer" && process.env.PANAS_DEMO_FREE === "1") {
        const configPath = process.env.PANAS_BUYER_CONFIG;
        if (!configPath) throw new SetupError("Missing demo configuration.");
        const directory = dirname(configPath),
            selected = directory.split(/[\\/]/).at(-1);
        if (
            !["codex", "antigravity", "terminal"].includes(selected ?? "") ||
            resolve(directory) !==
                resolve(homedir(), ".config/panas/clients", selected!)
        )
            throw new SetupError("Invalid demo directory.");
        await ensureDemoSession({
            home: homedir(),
            client: selected as DemoClient | "terminal",
        });
    }
    if (command === "setup") {
        const { envPath: demoEnv } = await prepareDemoConfig({
            home: homedir(),
            client,
        });
        const configurationFile = await installMcpClient({
            home: homedir(),
            client,
            envPath: demoEnv,
            cliPath: fileURLToPath(import.meta.url),
        });
        process.stdout.write(
            JSON.stringify({
                client,
                configurationFile,
                freeOnly: true,
                mcpServer: "panas",
                reloadClientIfToolsMissing: true,
            }) + "\n",
        );
        return;
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
        if (
            command === "provider" &&
            !values.plain &&
            process.stdin.isTTY &&
            process.stderr.isTTY &&
            process.env.TERM !== "dumb"
        ) {
            const { ConsoleModel, startConsole } = await import("./console.js");
            const { observeProvider } =
                await import("./provider-observation.js");
            const release = JSON.parse(
                await readFile(
                    new URL("../release.json", import.meta.url),
                    "utf8",
                ),
            );
            const controller = new AbortController();
            const model = new ConsoleModel({
                version: release.version,
                mode: "provider",
                providerId: process.env.PANAS_PROVIDER_ID ?? "",
                price:
                    process.env.PANAS_PRICE_ATOMIC === "0"
                        ? "Free · no wallet needed"
                        : `${process.env.PANAS_PRICE_ATOMIC ?? "?"} atomic ${process.env.PANAS_PRICE_CURRENCY ?? "TEST_CREDIT"} / request`,
            });
            let dismiss: (() => void) | undefined;
            const quit = () => {
                model.stopping = true;
                model.ready = false;
                model.detail =
                    "Stopping owned containers and preserving your keys and durable state.";
                model.update();
                controller.abort();
                dismiss?.();
            };
            const screen = startConsole(model, quit);
            process.once("SIGINT", quit);
            process.once("SIGTERM", quit);
            try {
                await launchDockerProvider(command, values["sandbox-image"], {
                    progress: (phase, detail) => model.progress(phase, detail),
                    status: (value) => {
                        observeProvider(model, value);
                    },
                    signal: controller.signal,
                });
            } catch {
                if (!controller.signal.aborted) {
                    model.failed = true;
                    model.ready = false;
                    model.log(`Stopped during: ${model.phase}`);
                    model.phase = "Provider could not start";
                    model.detail =
                        "Check Docker Desktop, the approved model, and provider enrollment. Press q to return to your shell.";
                    model.update();
                    process.exitCode = 1;
                    await new Promise<void>((resolve) => {
                        dismiss = resolve;
                    });
                }
            } finally {
                screen.stop();
                process.off("SIGINT", quit);
                process.off("SIGTERM", quit);
            }
        } else await launchDockerProvider(command, values["sandbox-image"]);
        return;
    }
    await import(new URL(modules[command]!, import.meta.url).href);
}
void main().catch((error: unknown) => {
    // Configuration/crypto exceptions can contain private material. Never print them.
    process.stderr.write(
        error instanceof SetupError
            ? error.message + "\n"
            : "Panas could not start. Use --help; verify Node 24, supported hardware, owner-only configuration, and a new identity directory.\n",
    );
    process.exitCode = 1;
});
