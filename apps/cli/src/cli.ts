#!/usr/bin/env node
import { readFile, mkdir, lstat, writeFile } from "node:fs/promises";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { parseArgs } from "node:util";

const help = `Panas — share bounded inference from an Apple Silicon Mac

panas --version
panas identity init --dir /absolute/private/directory
panas provider --env-file /absolute/private/provider.env
panas doctor --env-file /absolute/private/provider.env
panas buyer --env-file /absolute/private/buyer.env

Requires Node 24. Provider requires macOS 14+ on Apple Silicon and
explicitly installed pinned Ollama/model. Enrollment is operator-managed.
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
        !["provider", "doctor", "buyer"].includes(command)
    )
        throw new Error("Invalid command");
    if (values["env-file"]) {
        const path = resolve(values["env-file"]);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
            throw new Error("Private env file required");
        process.loadEnvFile(path);
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
    await import(new URL(modules[command]!, import.meta.url).href);
}
void main().catch(() => {
    // Configuration/crypto exceptions can contain private material. Never print them.
    process.stderr.write(
        "Panas could not start. Use --help; verify Node 24, supported hardware, owner-only configuration, and a new identity directory.\n",
    );
    process.exitCode = 1;
});
