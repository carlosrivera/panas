import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    mkdir,
    lstat,
    readFile,
    writeFile,
    rename,
    access,
    link,
    unlink,
} from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import {
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    randomUUID,
} from "node:crypto";
import {
    readOwnerConfig,
    readPrivateFile,
} from "../../buyer-mcp/src/config.js";
import {
    DOMAIN,
    demoBuyerId,
    signDocument,
    demoEnrollmentResponseSchema,
    verifyDemoDiscovery,
} from "@panas/protocol";
import type { DemoClient } from "./console.js";

const execute = promisify(execFile);
export class SetupError extends Error {}

async function privateDirectory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new SetupError("Use a real local configuration directory.");
}

export async function writeConfigFile(path: string, text: string) {
    await privateDirectory(dirname(path));
    let before: string | undefined;
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
            throw new SetupError(
                "Refusing to replace a non-regular configuration file.",
            );
        before = await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (before === text) return;
    if (before !== undefined)
        await writeFile(`${path}.panas-backup-${randomUUID()}`, before, {
            mode: 0o600,
            flag: "wx",
        });
    const temporary = `${path}.panas-${randomUUID()}`;
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
}

/** Existing owner files stay intact; new demos receive their own zero-authority identity. */
export async function prepareDemoConfig(options: {
    home: string;
    ownerPath?: string;
    fetcher?: typeof fetch;
    accountingUrl?: string;
    client: DemoClient | "terminal";
}) {
    let owner: ReturnType<typeof readOwnerConfig>;
    if (!options.ownerPath) return enrollDemo(options);
    try {
        owner = readOwnerConfig(options.ownerPath);
        for (const path of [
            owner.privateKeyPath,
            owner.platformPublicKeyPath,
            owner.discoveryTokenPath,
        ])
            readPrivateFile(path);
    } catch {
        throw new SetupError(
            "This computer needs an enrolled demo buyer. No client settings were changed. The existing enrolled buyer configuration could not be read safely.",
        );
    }
    const directory = join(
        options.home,
        ".config/panas/clients",
        options.client,
    );
    await privateDirectory(directory);
    const configPath = join(directory, "buyer.json");
    const envPath = join(directory, "buyer.env");
    if ([configPath, envPath].some((path) => /[\r\n]/.test(path)))
        throw new SetupError("Configuration paths cannot contain newlines.");
    if (configPath.includes('"'))
        throw new SetupError(
            "Configuration paths cannot contain double quotes.",
        );
    const config = {
        ...owner,
        dataDir: join(directory, "state"),
        limits: {
            maxRequestAtomic: "0",
            maxSessionAtomic: "0",
            maxDailyAtomic: "0",
        },
    };
    await writeConfigFile(configPath, JSON.stringify(config, null, 2) + "\n");
    // Node's dotenv parser supports quoted paths, including spaces.
    await writeConfigFile(envPath, `PANAS_BUYER_CONFIG="${configPath}"\n`);
    return { envPath, directory };
}

async function ensurePrivateFile(path: string, value: () => string) {
    try {
        return readPrivateFile(path).toString("utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${path}.${randomUUID()}`;
    await writeFile(temporary, value(), { mode: 0o600, flag: "wx" });
    try {
        await link(temporary, path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
        await unlink(temporary);
    }
    return readPrivateFile(path).toString("utf8");
}
export async function enrollDemo(options: {
    home: string;
    client: DemoClient | "terminal";
    fetcher?: typeof fetch;
    accountingUrl?: string;
}) {
    const directory = join(
        options.home,
        ".config/panas/clients",
        options.client,
    );
    await privateDirectory(directory);
    const privateKeyPath = join(directory, "demo.pem");
    const privateKey = createPrivateKey(
        await ensurePrivateFile(privateKeyPath, () =>
            generateKeyPairSync("ed25519")
                .privateKey.export({ type: "pkcs8", format: "pem" })
                .toString(),
        ),
    );
    const sessionId = (
        await ensurePrivateFile(join(directory, "demo-session"), () =>
            randomUUID(),
        )
    ).trim();
    const publicKeyPem = createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString();
    const now = Date.now();
    const proof = signDocument(
        DOMAIN.enrollment,
        {
            version: 1,
            publicKeyPem,
            sessionId,
            issuedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 120000).toISOString(),
        },
        privateKey,
    );
    const accountingUrl =
        options.accountingUrl ?? "https://panas.mcpwire.co/accounting";
    let enrolled;
    try {
        const send = () =>
            (options.fetcher ?? fetch)(`${accountingUrl}/demo/enroll`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(proof),
                signal: AbortSignal.timeout(15000),
            });
        let response: Response;
        try {
            response = await send();
        } catch {
            response = await send();
        }
        if (response.status >= 500) response = await send();
        if (!response.ok) throw new Error("Enrollment unavailable");
        const text = await response.text();
        if (text.length > 16384) throw new Error("Oversized response");
        enrolled = demoEnrollmentResponseSchema.parse(JSON.parse(text));
        const scope = verifyDemoDiscovery(
            enrolled.discoveryToken,
            enrolled.platformPublicKeyPem,
        );
        if (
            enrolled.buyerId !== demoBuyerId(privateKey) ||
            enrolled.sessionId !== sessionId ||
            scope.buyerId !== enrolled.buyerId ||
            scope.sessionId !== sessionId
        )
            throw new Error("Enrollment identity mismatch");
    } catch {
        throw new SetupError(
            "Automatic free demo enrollment is temporarily unavailable. Retry setup shortly; no paid access or client settings were changed.",
        );
    }
    const platformPublicKeyPath = join(directory, "platform.pem"),
        discoveryTokenPath = join(directory, "discovery-token");
    // Never silently rotate an established platform trust anchor.
    try {
        if (
            readPrivateFile(platformPublicKeyPath).toString("utf8") !==
            enrolled.platformPublicKeyPem
        )
            throw new SetupError(
                "The demo platform signing key changed. Existing trust was preserved.",
            );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeConfigFile(platformPublicKeyPath, enrolled.platformPublicKeyPem);
    await writeConfigFile(discoveryTokenPath, enrolled.discoveryToken);
    const configPath = join(directory, "buyer.json"),
        envPath = join(directory, "buyer.env");
    if (/[\r\n"]/.test(configPath))
        throw new SetupError("Unsupported configuration path.");
    await writeConfigFile(
        configPath,
        JSON.stringify(
            {
                buyerId: enrolled.buyerId,
                sessionId,
                privateKeyPath,
                platformPublicKeyPath,
                discoveryTokenPath,
                dataDir: join(directory, "state"),
                accountingUrl,
                registryUrl: "https://panas.mcpwire.co/registry",
                limits: {
                    maxRequestAtomic: "0",
                    maxSessionAtomic: "0",
                    maxDailyAtomic: "0",
                },
            },
            null,
            2,
        ) + "\n",
    );
    await writeConfigFile(
        envPath,
        `PANAS_BUYER_CONFIG="${configPath}"\nPANAS_DEMO_FREE=1\n`,
    );
    return { envPath, directory };
}

/** Avoid a network round trip on every MCP reconnect while the signed session is fresh. */
export async function ensureDemoSession(
    options: Parameters<typeof enrollDemo>[0],
) {
    const directory = join(
        options.home,
        ".config/panas/clients",
        options.client,
    );
    try {
        const owner = readOwnerConfig(join(directory, "buyer.json"));
        const key = createPrivateKey(readPrivateFile(owner.privateKeyPath));
        const token = verifyDemoDiscovery(
            readPrivateFile(owner.discoveryTokenPath).toString("utf8"),
            readPrivateFile(owner.platformPublicKeyPath),
        );
        if (
            token.buyerId === owner.buyerId &&
            token.sessionId === owner.sessionId &&
            owner.buyerId === demoBuyerId(key) &&
            Object.values(owner.limits).every((v) => v === "0") &&
            Date.parse(token.expiresAt) > Date.now() + 300000
        )
            return;
    } catch {
        /* Expired or incomplete local demo setup must be renewed before use. */
    }
    await enrollDemo(options);
}

export function mergeMcpJson(
    text: string,
    entry: { command: string; args: string[] },
) {
    const value: unknown = text.trim() ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new SetupError("The MCP configuration must be a JSON object.");
    const config = value as Record<string, unknown>;
    const servers = config.mcpServers ?? {};
    if (!servers || typeof servers !== "object" || Array.isArray(servers))
        throw new SetupError("The mcpServers setting must be a JSON object.");
    return (
        JSON.stringify(
            { ...config, mcpServers: { ...servers, panas: entry } },
            null,
            2,
        ) + "\n"
    );
}

export async function installMcpClient(options: {
    home: string;
    client: DemoClient;
    envPath: string;
    cliPath: string;
    nodePath?: string;
    codexBinary?: string;
}) {
    const nodePath = options.nodePath ?? process.execPath;
    if (![nodePath, options.cliPath, options.envPath].every(isAbsolute))
        throw new SetupError(
            "MCP requires absolute executable and configuration paths.",
        );
    const entry = {
        command: nodePath,
        args: [options.cliPath, "buyer", "--env-file", options.envPath],
    };
    if (options.client === "antigravity") {
        const path = join(options.home, ".gemini/config/mcp_config.json");
        let before = "{}";
        try {
            before = await readFile(path, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await writeConfigFile(path, mergeMcpJson(before, entry));
        return path;
    }
    const codexHome = process.env.CODEX_HOME ?? join(options.home, ".codex");
    await privateDirectory(codexHome);
    const path = join(codexHome, "config.toml");
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
            throw new SetupError("Use a regular Codex configuration file.");
        await writeFile(
            `${path}.panas-backup-${randomUUID()}`,
            await readFile(path),
            { mode: 0o600, flag: "wx" },
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let binary = options.codexBinary ?? "codex";
    if (!options.codexBinary && process.platform === "darwin") {
        const bundled =
            "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
        try {
            await access(bundled);
            binary = bundled;
        } catch {
            /* Use the documented CLI on PATH. */
        }
    }
    try {
        await execute(
            binary,
            ["mcp", "add", "panas", "--", entry.command, ...entry.args],
            {
                timeout: 15000,
                maxBuffer: 65536,
            },
        );
    } catch {
        throw new SetupError(
            "Codex MCP setup failed. Install or open Codex, then rerun Panas setup. Existing configuration has been backed up.",
        );
    }
    return path;
}
