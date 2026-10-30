import { randomBytes } from "node:crypto";
import { writeFile, chmod } from "node:fs/promises";
import { configFromEnv, prepareDataPath } from "./config.js";
import { createProviderRuntime } from "./docker-runtime.js";
import { inspectHost } from "./capabilities.js";
import { EncryptedStore } from "./store.js";
import { ProviderDaemon } from "./daemon.js";
import { serveLocal } from "./ipc.js";
import { claimProviderHost } from "./ownership.js";

const config = configFromEnv(),
    paths = await prepareDataPath(config.dataPath);
const ownership = await claimProviderHost(config.dataPath);
const runtime = await createProviderRuntime(config);
const daemon = new ProviderDaemon(
    config,
    runtime,
    new EncryptedStore(paths.storePath),
    () => inspectHost(config.dataPath),
);
let initialized = false;
const timer = setInterval(() => {
    daemon.observeLiveness();
    if (initialized)
        void daemon.health().catch(() => {
            void daemon.emergencyStop();
        });
}, 15000);
timer.unref();
const earlyStop = () => {
    clearInterval(timer);
    void runtime.stop().finally(() => process.exit(0));
};
process.once("SIGINT", earlyStop);
process.once("SIGTERM", earlyStop);
const token = randomBytes(32).toString("hex");
// The private parent directory and socket permissions limit access to this local account.
if (ownership.recovered) {
    /* Docker worker is owned by this sandbox, never adopt host runtimes. */
}
const report = await daemon.launch();
const server = await serveLocal(daemon, paths.socketPath, token).catch(
    async (error: unknown) => {
        await daemon.emergencyStop();
        throw error;
    },
);
await writeFile(paths.tokenPath, token, { mode: 0o600 });
await chmod(paths.tokenPath, 0o600);
console.log(
    JSON.stringify({
        startupId: report.startupId,
        state: report.state,
        peerProbe: report.peerProbe.status,
    }),
);
let closing = false;
initialized = true;
const cleanup = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await daemon.emergencyStop();
    server.close();
};
process.off("SIGINT", earlyStop);
process.off("SIGTERM", earlyStop);
process.once("SIGINT", () => {
    void cleanup();
});
process.once("SIGTERM", () => {
    void cleanup();
});
