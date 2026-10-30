import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtemp,
    readdir,
    readFile,
    writeFile,
    rm,
    lstat,
    mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { version } = JSON.parse(
    await readFile(resolve(root, "apps/cli/package.json"), "utf8"),
) as { version: string };
const tarball = resolve(root, `artifacts/panas-cli-${version}.tgz`);
const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim()
    .split("\n");
assert(
    files.every((name) =>
        /^package\/(?:bin\/|apps\/|scripts\/|package.json$|release.json$|provider.env.example$|LICENSE$|README.md$)/.test(
            name,
        ),
    ),
);
assert(
    !files.some((name) => /\.(?:ts|map|pem)$|\.panas|node_modules/.test(name)),
);
const scratch = await mkdtemp(join(tmpdir(), "panas-install-"));
const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? scratch,
    TMPDIR: tmpdir(),
};
let client: Client | undefined;
const token = randomBytes(32).toString("hex");
const ipc = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        const request = JSON.parse(buffer) as { token: string; method: string };
        socket.end(
            JSON.stringify(
                request.token === token && request.method === "status"
                    ? { ok: true, result: { fixture: "packaged-ipc" } }
                    : { ok: false },
            ) + "\n",
        );
    });
});
try {
    const cache = join(scratch, "cache");
    const initial = execFileSync(
        "npx",
        [
            "--yes",
            "--loglevel=error",
            "--cache",
            cache,
            `--package=${tarball}`,
            "panas",
            "--version",
        ],
        { cwd: scratch, env, encoding: "utf8", timeout: 120000 },
    );
    assert.equal(JSON.parse(initial).version, version);
    const installs = await readdir(join(cache, "_npx"));
    assert.equal(installs.length, 1);
    const installed = join(
        cache,
        "_npx",
        installs[0]!,
        "node_modules/@panas/cli",
    );
    const bin = join(installed, "bin/panas.js");
    const run = (args: string[]) =>
        execFileSync(process.execPath, [bin, ...args], {
            cwd: scratch,
            env,
            encoding: "utf8",
            timeout: 15000,
            stdio: ["ignore", "pipe", "pipe"],
        });
    const release = JSON.parse(run(["--version"])) as {
        version: string;
        sourceCommit: string;
    };
    assert.equal(release.version, version);
    assert.match(release.sourceCommit, /^[a-f0-9]{40}$/);
    assert.match(run(["--help"]), /panas provider/);
    const identity = join(scratch, "identity");
    const created = JSON.parse(
        run(["identity", "init", "--dir", identity]),
    ) as { providerId: string };
    assert.match(created.providerId, /^[a-f0-9-]{36}$/);
    assert.equal(
        (await lstat(join(identity, "provider.pem"))).mode & 0o777,
        0o600,
    );
    const original = await readFile(join(identity, "provider.pem"));
    assert.throws(() => run(["identity", "init", "--dir", identity]));
    assert.deepEqual(await readFile(join(identity, "provider.pem")), original);
    // Resolve and execute the external CLI from the installed package, without a repo cwd/tsx loader.
    const require = createRequire(join(installed, "package.json"));
    const wirePath = require.resolve("@mcpwire/cli/package.json");
    const wire = JSON.parse(await readFile(wirePath, "utf8")) as {
        version: string;
        bin: { mcpwire: string };
    };
    assert.equal(wire.version, "1.1.0");
    // --help alone does not load the real share/join native dependency graph.
    const wireRequire = createRequire(wirePath);
    assert.equal(typeof wireRequire("hyperdht"), "function");
    assert.match(
        execFileSync(
            process.execPath,
            [resolve(dirname(wirePath), wire.bin.mcpwire), "--help"],
            { cwd: scratch, env, encoding: "utf8", timeout: 15000 },
        ),
        /share/,
    );
    const state = join(scratch, "state");
    await mkdir(state, { mode: 0o700 });
    await writeFile(join(state, "ipc-token"), token, { mode: 0o600 });
    await new Promise<void>((done) =>
        ipc.listen(join(state, "daemon.sock"), done),
    );
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(installed, "apps/provider-mcp/src/main.js")],
        cwd: scratch,
        env: { ...env, PANAS_DATA_PATH: state },
    });
    client = new Client({ name: "package-smoke", version: "1" });
    await client.connect(transport);
    const result = await client.callTool({
        name: "get_capabilities",
        arguments: {},
    });
    assert.deepEqual(result.structuredContent, { fixture: "packaged-ipc" });
    console.log(
        `Fresh npx cache outside checkout: CLI, immutable identity, external MCPWire and bundled MCP adapter/IPC passed (${version}).`,
    );
} finally {
    await client?.close();
    ipc.close();
    await rm(scratch, { recursive: true, force: true });
}
