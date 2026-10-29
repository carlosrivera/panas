import { expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// The real host intentionally rejects other platforms before starting its runtime.
// The child executable is a lifecycle fixture, not model or physical-device proof.
it.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
    "awaits an existing signal shutdown before the startup catch exits its native process owner",
    async () => {
        const directory = await mkdtemp(join(tmpdir(), "panas-host-shutdown-"));
        const binary = join(directory, "native-fixture.mjs");
        const marker = join(directory, "native.pid");
        const keys = generateKeyPairSync("ed25519");
        const privatePath = join(directory, "provider.pem"),
            publicPath = join(directory, "platform.pem");
        await writeFile(
            privatePath,
            keys.privateKey.export({ type: "pkcs8", format: "pem" }),
            { mode: 0o600 },
        );
        await writeFile(
            publicPath,
            keys.publicKey.export({ type: "spki", format: "pem" }),
            { mode: 0o600 },
        );
        const models = join(directory, "models");
        await mkdir(models, { mode: 0o700 });
        await writeFile(
            binary,
            `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
process.on('SIGTERM',()=>{});
writeFileSync(${JSON.stringify(marker)},String(process.pid));
setTimeout(()=>createServer((req,res)=>res.writeHead(200).end('{}')).listen(Number(process.env.OLLAMA_HOST.split(':').at(-1)),'127.0.0.1'),10000);
`,
            { mode: 0o700 },
        );
        const reservation = createServer();
        await new Promise<void>((resolve) =>
            reservation.listen(0, "127.0.0.1", resolve),
        );
        const address = reservation.address();
        if (!address || typeof address === "string")
            throw new Error("NO_TEST_PORT");
        await new Promise<void>((resolve) =>
            reservation.close(() => resolve()),
        );
        const root = fileURLToPath(new URL("../../../", import.meta.url));
        const child = spawn(
            process.execPath,
            ["--import", "tsx", join(root, "apps/provider-mcp/src/host.ts")],
            {
                cwd: root,
                detached: true,
                stdio: "ignore",
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    TMPDIR: process.env.TMPDIR,
                    PANAS_PROVIDER_ID: randomUUID(),
                    PANAS_MODEL_DIGEST: "0".repeat(64),
                    PANAS_OLLAMA_VERSION: "0.0.0",
                    PANAS_DATA_PATH: join(directory, "state"),
                    PANAS_OLLAMA_BINARY: binary,
                    PANAS_MODELS_PATH: models,
                    PANAS_OLLAMA_ENDPOINT: "http://127.0.0.1:" + address.port,
                    PANAS_PROVIDER_PRIVATE_KEY_PATH: privatePath,
                    PANAS_PLATFORM_PUBLIC_KEY_PATH: publicPath,
                    PANAS_REGISTRY_URL: "https://127.0.0.1:9",
                    PANAS_ACCOUNTING_URL: "https://127.0.0.1:9",
                    PANAS_PRICE_ATOMIC: "1",
                },
            },
        );
        let nativePid = 0;
        try {
            for (let attempt = 0; attempt < 250; attempt++) {
                try {
                    nativePid = Number(await readFile(marker, "utf8"));
                    break;
                } catch {
                    await delay(20);
                }
            }
            expect(nativePid).toBeGreaterThan(0);
            const exited = new Promise<void>((resolve) =>
                child.once("exit", () => resolve()),
            );
            child.kill("SIGTERM");
            await Promise.race([
                exited,
                delay(5000).then(() => {
                    throw new Error("HOST_SHUTDOWN_TIMED_OUT");
                }),
            ]);
            // The fixture ignores SIGTERM: success requires the owner's awaited SIGKILL fallback.
            expect(() => process.kill(nativePid, 0)).toThrow();
        } finally {
            if (
                child.pid &&
                child.exitCode === null &&
                child.signalCode === null
            ) {
                try {
                    process.kill(-child.pid, "SIGKILL");
                } catch {
                    /* Already gone. */
                }
            }
            if (nativePid) {
                try {
                    const command = execFileSync(
                        "ps",
                        ["-p", String(nativePid), "-o", "command="],
                        {
                            encoding: "utf8",
                            stdio: ["ignore", "pipe", "ignore"],
                        },
                    );
                    if (command.includes(binary))
                        process.kill(-nativePid, "SIGKILL");
                } catch {
                    /* Fixture already reaped. */
                }
            }
            await rm(directory, { recursive: true, force: true });
        }
    },
    10000,
);
