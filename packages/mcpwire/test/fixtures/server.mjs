// Actual separate MCPWire peer smoke fixture. No model, credentials, or persistence claim.
import { createInterface } from "node:readline";
import { connect } from "node:net";
const startupId = process.argv[2];
createInterface({ input: process.stdin }).on("line", async (line) => {
    const request = JSON.parse(line);
    if (!request.id) return;
    let result;
    if (request.method === "initialize")
        result = {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "panas-smoke-fixture", version: "1" },
        };
    else if (request.method === "tools/list")
        result = {
            tools: [
                {
                    name: "get_capabilities",
                    description: "Local peer fixture only",
                    inputSchema: { type: "object", properties: {} },
                },
            ],
        };
    else if (request.method === "tools/call") {
        let daemon = {};
        if (process.argv[3])
            daemon = await new Promise((resolve, reject) => {
                const socket = connect(process.argv[3]);
                let data = "";
                socket.on("data", (chunk) => {
                    data += chunk.toString();
                });
                socket.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(error);
                    }
                });
                socket.on("error", reject);
            });
        result = {
            content: [],
            structuredContent: { startupId, pid: process.pid, ...daemon },
        };
    } else result = {};
    process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
    );
});
