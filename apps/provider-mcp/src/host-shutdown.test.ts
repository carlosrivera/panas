import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
it("rejects a bare internet-facing host before its native runtime can start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "panas-unconfined-"));
    try {
        const keys = generateKeyPairSync("ed25519");
        await writeFile(
            join(dir, "key.pem"),
            keys.privateKey.export({ type: "pkcs8", format: "pem" }),
            { mode: 0o600 },
        );
        await writeFile(
            join(dir, "pub.pem"),
            keys.publicKey.export({ type: "spki", format: "pem" }),
            { mode: 0o600 },
        );
        const marker = join(dir, "native-started");
        await writeFile(join(dir, "ollama"), `#!/bin/sh\ntouch '${marker}'\n`, {
            mode: 0o700,
        });
        const root = fileURLToPath(new URL("../../../", import.meta.url));
        await expect(
            promisify(execFile)(
                process.execPath,
                [
                    "--import",
                    "tsx",
                    join(root, "apps/provider-mcp/src/host.ts"),
                ],
                {
                    cwd: root,
                    timeout: 10000,
                    env: {
                        PATH: process.env.PATH,
                        HOME: process.env.HOME,
                        PANAS_PROVIDER_ID: randomUUID(),
                        PANAS_MODEL_DIGEST: "a".repeat(64),
                        PANAS_OLLAMA_VERSION: "0.40.12",
                        PANAS_DATA_PATH: join(dir, "state"),
                        PANAS_MODELS_PATH: dir,
                        PANAS_OLLAMA_BINARY: join(dir, "ollama"),
                        PANAS_PROVIDER_PRIVATE_KEY_PATH: join(dir, "key.pem"),
                        PANAS_PLATFORM_PUBLIC_KEY_PATH: join(dir, "pub.pem"),
                        PANAS_ACCOUNTING_URL: "https://127.0.0.1:9",
                    },
                },
            ),
        ).rejects.toMatchObject({ code: 1 });
        await expect(readFile(marker)).rejects.toMatchObject({
            code: "ENOENT",
        });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 15000);
