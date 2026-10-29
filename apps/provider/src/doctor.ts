import { configFromEnv, prepareDataPath } from "./config.js";
import { OllamaRuntime } from "./runtime.js";
import { inspectHost, testCapabilities } from "./capabilities.js";

const config = configFromEnv();
await prepareDataPath(config.dataPath);
const runtime = new OllamaRuntime(config);
const stop = () => {
    void runtime.stop().finally(() => process.exit(1));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
    const report = await testCapabilities(
        config,
        runtime,
        await inspectHost(config.dataPath),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.state === "testing" ? 0 : 1;
} finally {
    await runtime.stop();
}
