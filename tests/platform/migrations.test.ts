import { describe, it, expect } from "vitest";
import {
    assertChecksum,
    migrationsAt,
} from "../../scripts/platform/migrations.js";
import { cleanEnvironment, token } from "../../scripts/platform/runtime.js";
import { PLATFORM } from "../../scripts/platform/config.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("platform release safety boundaries", () => {
    it("detects byte changes and excludes non-migration files", async () => {
        const dir = await mkdtemp(join(tmpdir(), "panas-sql-"));
        try {
            await writeFile(join(dir, "010_example.sql"), "SELECT 1;\n");
            await writeFile(join(dir, "notes.sql"), "SELECT 2;");
            const first = await migrationsAt(dir);
            expect(first).toHaveLength(1);
            await writeFile(join(dir, "010_example.sql"), "SELECT 2;\n");
            const next = await migrationsAt(dir);
            expect(() =>
                assertChecksum(
                    next[0]!.sha256,
                    first[0]!.sha256,
                    first[0]!.name,
                ),
            ).toThrow("Applied migration changed");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it("refuses another project and account-wide credentials", () => {
        const saved = { ...process.env };
        try {
            process.env.VOLCANO_PROJECT_ID = "another-project";
            expect(() => cleanEnvironment()).toThrow(
                "different Volcano project",
            );
            process.env.VOLCANO_PROJECT_ID = PLATFORM.projectId;
            process.env.VOLCANO_TOKEN = "pk-test-not-a-secret";
            expect(() => token()).toThrow("account-wide");
            process.env.VOLCANO_TOKEN = "pt-fixture";
            expect(token()).toBe("pt-fixture");
            process.env.VOLCANO_DEBUG = "1";
            expect(cleanEnvironment().VOLCANO_DEBUG).toBeUndefined();
        } finally {
            process.env = saved;
        }
    });
});

import { assertIsolatedBranch } from "../../scripts/platform/isolation.js";
it("requires API-owned branch identity, exact connection and short TTL before destructive preparation", () => {
    const source = {
        id: "source",
        project_id: PLATFORM.projectId,
        name: "registry",
        connection_string:
            "postgresql://volcano_client_source:fixture@database.example/registry",
    };
    const branch = {
        id: "branch",
        project_id: PLATFORM.projectId,
        database_id: "source",
        name: "platform_empty_check",
        status: "active",
        ttl_seconds: 7200,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        connection_string:
            "postgresql://volcano_client_branch:fixture@database.example/registry",
    };
    expect(() =>
        assertIsolatedBranch(branch.connection_string, source, branch),
    ).not.toThrow();
    expect(() =>
        assertIsolatedBranch(
            "postgresql://other_production_role:fixture@database.example/registry",
            source,
            branch,
        ),
    ).toThrow("API-verified");
    expect(() =>
        assertIsolatedBranch(branch.connection_string, source, {
            ...branch,
            project_id: "foreign",
        }),
    ).toThrow("API-verified");
    expect(() =>
        assertIsolatedBranch(branch.connection_string, source, {
            ...branch,
            ttl_seconds: 86400,
        }),
    ).toThrow("API-verified");
});
