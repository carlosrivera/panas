import { join } from "node:path";
import { mkdir, chmod, lstat } from "node:fs/promises";
import { providerConfigSchema } from "@panas/contracts/provider";

export function configFromEnv() {
    return providerConfigSchema.parse({
        providerId: process.env.PANAS_PROVIDER_ID,
        expectedDigest: process.env.PANAS_MODEL_DIGEST,
        expectedRuntimeVersion: process.env.PANAS_OLLAMA_VERSION,
        dataPath: process.env.PANAS_DATA_PATH,
        binary: process.env.PANAS_OLLAMA_BINARY,
        modelsPath: process.env.PANAS_MODELS_PATH,
        endpoint: process.env.PANAS_OLLAMA_ENDPOINT ?? "http://127.0.0.1:11536",
    });
}
export async function prepareDataPath(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Data path must be a dedicated real directory");
    await chmod(path, 0o700);
    return {
        storePath: join(path, "requests"),
        socketPath: join(path, "daemon.sock"),
        tokenPath: join(path, "ipc-token"),
    };
}
