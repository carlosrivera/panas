import pg from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLATFORM } from "./config.js";
import { applyMigrations, migrationsAt } from "./migrations.js";
import {
    assertClean,
    assertProjectBinding,
    management,
    revision,
    root,
    run,
    token,
    variable,
    volcano,
} from "./runtime.js";
import { verifyRelease } from "./verify.js";

try {
    await assertProjectBinding();
    token();
    assertClean();
    if (Number(process.versions.node.split(".")[0]) !== PLATFORM.nodeMajor)
        throw new Error("Use Node 24");
    if (run("pnpm", ["--version"], true).trim() !== PLATFORM.pnpm)
        throw new Error("Use the pinned pnpm version");
    if (
        !run(volcano, ["--version"], true).startsWith(
            `volcano v${PLATFORM.volcano} `,
        )
    )
        throw new Error("Use the pinned Volcano CLI");
    run("pnpm", ["install", "--frozen-lockfile"]);
    run("pnpm", ["format:check"]);
    run("pnpm", ["check"]);
    run("pnpm", ["platform:bundle"]);
    // Upsert only the nonsecret public-read base. Never replace the project's variable set.
    let exists = true;
    try {
        await variable("PUBLIC_REGISTRY_URL");
    } catch {
        exists = false;
    }
    await management(
        `/projects/${PLATFORM.projectId}/variables${exists ? "/PUBLIC_REGISTRY_URL" : ""}`,
        {
            method: exists ? "PUT" : "POST",
            body: JSON.stringify({
                ...(exists ? {} : { name: "PUBLIC_REGISTRY_URL" }),
                value: PLATFORM.registryUrl,
                shared: false,
            }),
        },
    );
    // Only public devnet settings are defaulted. Preserve explicit operator values.
    // No treasury signing key is read, uploaded or passed to an inference process.
    const devnet = JSON.parse(
        await readFile(resolve(root, "volcano/devnet-payments.json"), "utf8"),
    ) as {
        network: string;
        rpcUrl: string;
        mint: string;
        treasuryOwner: string;
        treasuryTokenAccount: string;
        mainnetEnabled: boolean;
    };
    if (
        devnet.network !== "solana-devnet" ||
        devnet.mainnetEnabled ||
        devnet.mint !== "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    )
        throw new Error(
            "Only pinned devnet payment configuration is supported",
        );
    for (const [name, value] of Object.entries({
        PANAS_SOLANA_DEVNET_RPC_URL: devnet.rpcUrl,
        PANAS_SOLANA_DEVNET_TREASURY_OWNER: devnet.treasuryOwner,
        PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT: devnet.treasuryTokenAccount,
    })) {
        try {
            await variable(name);
            continue;
        } catch {
            /* Missing public setting; POST cannot overwrite an existing variable. */
        }
        await management(`/projects/${PLATFORM.projectId}/variables`, {
            method: "POST",
            body: JSON.stringify({ name, value, shared: false }),
        });
    }
    const keys = await management<{
        data: { name: string; project_id: string }[];
    }>(`/projects/${PLATFORM.projectId}/service-keys`);
    if (
        !keys.data.some(
            (key) =>
                key.name === "panas-operations" &&
                key.project_id === PLATFORM.projectId,
        )
    )
        await management(`/projects/${PLATFORM.projectId}/service-keys`, {
            method: "POST",
            body: JSON.stringify({ name: "panas-operations" }),
        });
    const pool = new pg.Pool({
        connectionString: await variable("PANAS_REGISTRY_DATABASE_URL"),
        max: 1,
        connectionTimeoutMillis: 10000,
        query_timeout: 120000,
    });
    pool.on("error", () =>
        console.warn("Deployment database connection interrupted"),
    );
    let migration;
    try {
        migration = await applyMigrations(
            pool,
            await migrationsAt(resolve(root, "volcano/migrations")),
            revision(),
        );
    } finally {
        await pool.end();
    }
    run(volcano, ["cloud", "config", "deploy", "--dry-run"]);
    const frontend = !process.argv.includes("--functions-only");
    run(volcano, [
        "cloud",
        "deploy",
        "--no-env-file",
        ...(frontend ? [] : ["--no-frontends"]),
    ]);
    assertClean();
    await verifyRelease(frontend, migration);
    // Confirm the manifest itself was part of this clean committed release.
    await readFile(resolve(root, "volcano-config.yaml"), "utf8");
} catch {
    console.error(
        "Panas test deployment failed. No release is verified; inspect sanitized build/CLI output and operator health.",
    );
    process.exitCode = 1;
}
