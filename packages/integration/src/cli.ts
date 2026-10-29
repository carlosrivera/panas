import { parseArgs } from "node:util";
import { prepare } from "./prepare.js";
import { run } from "./runner.js";
import { runFailureFixtures } from "./fixtures.js";
const [mode, ...args] = process.argv.slice(2);
try {
    const { values } = parseArgs({
        args,
        options: { config: { type: "string" }, output: { type: "string" } },
    });
    let artifact: string;
    if (mode === "prepare" && values.config)
        artifact = await prepare(values.config);
    else if (mode === "local-simulation" && values.config)
        artifact = await run(values.config);
    else if (mode === "manual-two-machine" && values.config)
        artifact = await run(values.config, true);
    else if (mode === "failure-fixtures" && values.output)
        artifact = await runFailureFixtures(values.output);
    else throw new Error("CONFIGURATION_REQUIRED");
    console.log(
        JSON.stringify({
            artifact,
            mode,
            physicalEvidence:
                mode === "manual-two-machine"
                    ? "operator_attested"
                    : "two_physical_macs_pending",
        }),
    );
} catch {
    console.error(
        "Integration did not complete. Review the private evidence/configuration; no secrets or raw child diagnostics are printed.",
    );
    process.exitCode = 1;
}
