import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { createProviderServer } from "./server.js";
import { callDaemon } from "./ipc-client.js";

const path = process.env.PANAS_DATA_PATH;
if (!path?.startsWith("/"))
    throw new Error(
        "Provider adapter requires private local daemon configuration",
    );
const server = createProviderServer({
    async capabilities() {
        return (await callDaemon(
            join(path, "daemon.sock"),
            join(path, "ipc-token"),
            "status",
        )) as Record<string, unknown>;
    },
    operation(tool, request) {
        return callDaemon(
            join(path, "daemon.sock"),
            join(path, "ipc-token"),
            "paid",
            { operation: { tool, request } },
        );
    },
});
await server.connect(new StdioServerTransport());
