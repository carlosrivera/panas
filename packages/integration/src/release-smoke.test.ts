import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { run } from "./runner.js";
import { TEST_ACCOUNTING_URL, TEST_REGISTRY_URL } from "./config.js";
it("refuses to start a release smoke or purchase before a verified release reference exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "panas-release-gate-")),
        path = join(directory, "run.json");
    try {
        await writeFile(
            path,
            JSON.stringify({
                version: 1,
                mode: "local-simulation",
                physicalMachineCount: 1,
                privateDir: join(directory, "never-started"),
                registryUrl: TEST_REGISTRY_URL,
                accountingUrl: TEST_ACCOUNTING_URL,
                buyerConfigPath: join(directory, "buyer-not-present.json"),
                providerEnvs: [
                    join(directory, "provider-a-not-present.env"),
                    join(directory, "provider-b-not-present.env"),
                ],
                providerIds: [randomUUID(), randomUUID()],
                runtimePorts: [11601, 11602],
                operatorEnvPath: join(directory, "operator-not-present.env"),
            }),
            { mode: 0o600 },
        );
        await expect(run(path, false, true)).rejects.toThrow(
            "VERIFIED_RELEASE_REFERENCE_REQUIRED",
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
