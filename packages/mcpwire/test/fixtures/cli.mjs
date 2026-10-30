import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [mode, ...args] = process.argv.slice(2);
const timer = setInterval(() => {}, 1000);
if (mode === "share" || mode === "tree") {
    const ticket = `wire://${randomBytes(32).toString("hex")}`;
    if (mode === "tree") {
        const child = spawn(
            process.execPath,
            ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
            { stdio: "ignore" },
        );
        writeFileSync(args[0], String(child.pid));
    }
    const out = `MCPWire v1.1.3 · fixture · Listening\n  "args": ["-y", "@mcpwire/cli", "join", "${ticket}"]\n`;
    process.stderr.write(out.slice(0, 37));
    setTimeout(() => process.stderr.write(out.slice(37)), 10);
    process.stderr.write("UPSTREAM_SECRET_ARGUMENT_PREVIEW_MUST_NOT_ESCAPE\n");
} else if (mode === "fail") {
    process.stderr.write("sensitive child diagnostic");
    process.exit(17);
} else if (mode === "malformed") {
    process.stdout.write("not-json\n");
} else if (
    mode === "rpc" ||
    mode === "disconnect" ||
    mode === "wrong-startup"
) {
    createInterface({ input: process.stdin }).on("line", (line) => {
        const request = JSON.parse(line);
        if (!request.id) return;
        if (request.method === "initialize") {
            process.stdout.write(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: request.id,
                    result: {
                        protocolVersion: "2025-11-25",
                        capabilities: { tools: {} },
                        serverInfo: { name: "fixture", version: "1" },
                    },
                }) + "\n",
            );
        } else if (request.method === "tools/call") {
            if (mode === "disconnect") process.exit(0);
            else
                process.stdout.write(
                    JSON.stringify({
                        jsonrpc: "2.0",
                        id: request.id,
                        result: {
                            content: [],
                            structuredContent: {
                                startupId:
                                    mode === "wrong-startup"
                                        ? "stale"
                                        : args[0],
                            },
                        },
                    }) + "\n",
                );
        } else if (request.method === "never") {
            process.stderr.write("secret not logged");
        } else {
            process.stdout.write(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: request.id,
                    result: request.params,
                }) + "\n",
            );
        }
    });
}
process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
});
