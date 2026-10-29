import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { retainPrivateDiagnostics } from "./private-log.js";
export class ToolFailure extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}
export async function connectBuyer(ownerConfig: string, extraCaPath?: string) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            "--import",
            "tsx",
            fileURLToPath(
                new URL("../../../apps/buyer-mcp/src/cli.ts", import.meta.url),
            ),
        ],
        env: {
            ...Object.fromEntries(
                Object.entries(process.env).filter(
                    (entry): entry is [string, string] =>
                        entry[1] !== undefined,
                ),
            ),
            PANAS_BUYER_CONFIG: ownerConfig,
            ...(extraCaPath ? { NODE_EXTRA_CA_CERTS: extraCaPath } : {}),
        },
        stderr: "pipe",
    });
    // Discard even sanitized child errors: report only controlled metadata from this harness.
    const closeLogs = retainPrivateDiagnostics(dirname(ownerConfig), "buyer", [
        transport.stderr as import("node:stream").Readable,
    ]);
    const client = new Client({ name: "panas-integration", version: "0.1.0" });
    try {
        await client.connect(transport);
    } catch {
        await client.close();
        closeLogs();
        throw new ToolFailure("BUYER_STARTUP_FAILED");
    }
    return {
        close: async () => {
            try {
                await client.close();
            } finally {
                closeLogs();
            }
        },
        async call(
            name: string,
            args: Record<string, unknown>,
        ): Promise<Record<string, unknown>> {
            const response = await client.callTool(
                { name, arguments: args },
                undefined,
                { timeout: 120000 },
            );
            const data = response.structuredContent;
            if (!data || typeof data !== "object")
                throw new ToolFailure("INVALID_TOOL_RESULT");
            if (response.isError) {
                const error = "error" in data ? data.error : undefined;
                throw new ToolFailure(
                    error && typeof error === "object" && "code" in error
                        ? String(error.code)
                        : "TOOL_FAILED",
                );
            }
            return data as Record<string, unknown>;
        },
    };
}
