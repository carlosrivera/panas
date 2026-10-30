import { reservePeerPort } from "../../apps/cli/src/docker-provider.js";
/** Actual host Node -> Docker UDP -> external MCPWire CLI -> MCP fixture.
 * No cloud credentials, model, purchase, transport mocks or Docker buyer.
 */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliCommand, joinArgs } from "../../packages/mcpwire/src/index.js";

const exec = promisify(execFile);
const release = JSON.parse(
    await readFile("dist/panas-cli/release.json", "utf8"),
) as { version: string };
const image =
    process.env.PANAS_SANDBOX_BUILD_TAG ?? `panas-provider:${release.version}`;
const name = `panas-native-peer-${randomUUID()}`;
const server = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',l=>{const p=JSON.parse(l);if(p.id===undefined)return;const result=p.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'network-fixture',version:'1'}}:p.method==='tools/list'?{tools:[{name:'get_capabilities',inputSchema:{type:'object'}}]}:{content:[],structuredContent:{platform:process.platform,uid:process.getuid()}};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:p.id,result})+'\\n')});`;
const lease = await reservePeerPort();
const createArgs = [
    "create",
    "--name",
    name,
    "--read-only",
    "--user",
    "10001:10001",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--memory",
    "256m",
    "--cpus",
    "0.5",
    "--pids-limit",
    "64",
    "--network",
    "bridge",
    "--publish",
    `0.0.0.0:${lease.port}:49737/udp`,
    "--entrypoint",
    "node",
    image,
    "/opt/panas/node_modules/@mcpwire/cli/dist/index.js",
    "share",
    "--port",
    "49737",
    "--ttl",
    "3m",
    "--allow",
    "get_capabilities",
    "--",
    "node",
    "-e",
    server,
];
await exec("docker", createArgs);
await lease.release();
const host = spawn("docker", ["start", "--attach", "--interactive", name], {
    stdio: ["pipe", "pipe", "pipe"],
});
let output = "",
    spawnError = false;
host.on("error", () => {
    spawnError = true;
});
host.stdout.resume();
host.stderr.on("data", (chunk: Buffer) => {
    if (output.length < 65536) output += chunk.toString();
});
try {
    const until = Date.now() + 45000;
    while (
        !/wire:\/\/[a-f0-9]{64}/.test(output) &&
        Date.now() < until &&
        !spawnError &&
        host.exitCode === null
    )
        await new Promise((resolve) => setTimeout(resolve, 100));
    const ticket = output.match(/wire:\/\/[a-f0-9]{64}/)?.[0];
    assert(
        ticket,
        "Docker share must announce; private diagnostics suppressed",
    );
    const inspect = JSON.parse(
        (await exec("docker", ["inspect", name])).stdout,
    ) as {
        NetworkSettings: { Ports: Record<string, { HostPort: string }[]> };
    }[];
    const port = Number(
        inspect[0]!.NetworkSettings.Ports["49737/udp"]![0]!.HostPort,
    );
    assert.equal(
        port,
        lease.port,
        "Docker must preserve the explicitly reserved host port",
    );
    for (let i = 0; i < 3; i++) {
        const client = new Client({
            name: "native-docker-regression",
            version: "1",
        });
        const transport = new StdioClientTransport({
            ...cliCommand(joinArgs(ticket, [{ host: "127.0.0.1", port }])),
            stderr: "pipe",
        });
        transport.stderr?.on("data", () => {});
        try {
            await client.connect(transport, { timeout: 45000 });
            const result = await client.callTool({
                name: "get_capabilities",
                arguments: {},
            });
            assert.deepEqual(result.structuredContent, {
                platform: "linux",
                uid: 10001,
            });
        } finally {
            await client.close();
        }
    }
    console.log(
        JSON.stringify({
            status: "passed",
            buyerPlatform: process.platform,
            buyerIsolation: "native-host",
            providerIsolation: "docker-bridge",
            freshConnections: 3,
            publishedProtocol: "udp",
            cloudPurchase: false,
        }),
    );
} finally {
    await exec("docker", ["stop", "--time", "2", name]).catch(() => {});
    await exec("docker", ["rm", "--force", name]).catch(() => {});
    host.stdin.destroy();
    host.stdout.destroy();
    host.stderr.destroy();
}
