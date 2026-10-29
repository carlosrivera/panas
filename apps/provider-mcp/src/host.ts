import { readFile, writeFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { createPublicKey, randomBytes } from "node:crypto";
import {
    configFromEnv,
    prepareDataPath,
    OllamaRuntime,
    ProviderDaemon,
    EncryptedStore,
    inspectHost,
    serveLocal,
    claimProviderHost,
    waitForPreviousRuntime,
} from "@panas/provider";
import { registryPriceSchema } from "@panas/contracts/registry";
import { AccountingHttpClient } from "./accounting-client.js";
import { ProviderHostService } from "./service.js";
import { ProviderController } from "./controller.js";

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing owner configuration ${name}`);
    return value;
}
const config = configFromEnv(),
    paths = await prepareDataPath(config.dataPath);
const ownership = await claimProviderHost(config.dataPath);
const keyPath = required("PANAS_PROVIDER_PRIVATE_KEY_PATH");
if ((await stat(keyPath)).mode & 0o077)
    throw new Error(
        "Provider private key must be mode0600 or more restrictive",
    );
const privateKey = await readFile(keyPath, "utf8"),
    platformPublicKey = await readFile(
        required("PANAS_PLATFORM_PUBLIC_KEY_PATH"),
        "utf8",
    );
const publicKeyPem = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
const accounting = new AccountingHttpClient(
    required("PANAS_ACCOUNTING_URL"),
    config.providerId,
    privateKey,
);
const service = new ProviderHostService(
    {
        providerId: config.providerId,
        providerPrivateKey: privateKey,
        platformPublicKey,
    },
    new EncryptedStore(join(config.dataPath, "nonces")),
    accounting,
);
const runtime = new OllamaRuntime(config);
const daemon = new ProviderDaemon(
    config,
    runtime,
    new EncryptedStore(paths.storePath),
    () => inspectHost(config.dataPath),
    () => Date.now(),
    service.hooks,
);
service.bind(daemon);
const controller = new ProviderController(
    {
        registryUrl: required("PANAS_REGISTRY_URL"),
        providerId: config.providerId,
        providerPublicKeyPem: publicKeyPem,
        privateKey,
        price: registryPriceSchema.parse({
            version: process.env.PANAS_PRICE_VERSION ?? "1",
            totalAtomic: required("PANAS_PRICE_ATOMIC"),
            currency: "TEST_CREDIT",
        }),
    },
    daemon,
    service,
    accounting,
);
let server: Awaited<ReturnType<typeof serveLocal>> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let closing = false;
let stopping: Promise<void> | undefined;
function stop(): Promise<void> {
    if (stopping) return stopping;
    closing = true;
    runtime.beginShutdown();
    if (timer) clearInterval(timer);
    stopping = (async () => {
        try {
            await controller.stop();
        } finally {
            server?.close();
            await runtime.stop();
        }
    })();
    return stopping;
}
process.once("SIGTERM", () => {
    void stop();
});
process.once("SIGINT", () => {
    void stop();
});
try {
    if (ownership.recovered) await waitForPreviousRuntime(runtime.url);
    await daemon.launch();
    if (closing) throw new Error("HOST_SHUTDOWN");
    await service.init();
    const token = randomBytes(32).toString("hex");
    server = await serveLocal(daemon, paths.socketPath, token, (operation) =>
        service.handle(operation),
    );
    await writeFile(paths.tokenPath, token, { mode: 0o600 });
    await chmod(paths.tokenPath, 0o600);
    await controller.tick();
    if (closing) throw new Error("HOST_SHUTDOWN");
    timer = setInterval(() => {
        void controller.tick();
    }, 15000);
    console.log(
        JSON.stringify({
            providerId: config.providerId,
            state: daemon.status?.state,
            peerProbe: daemon.status?.peerProbe.status,
        }),
    );
} catch (error) {
    await stop();
    throw error;
}
