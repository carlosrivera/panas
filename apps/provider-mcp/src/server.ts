import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface HostAdapter {
    capabilities(): Promise<Record<string, unknown>>;
    operation(tool: string, request: unknown): Promise<unknown>;
}
export function createProviderServer(adapter: HostAdapter) {
    const server = new McpServer({ name: "panas-provider", version: "0.1.0" });
    server.registerTool(
        "get_capabilities",
        {
            description:
                "Read the current startup-bound provider capability report. Public metadata only.",
            inputSchema: z.object({}).strict(),
        },
        async () => {
            try {
                const report = await adapter.capabilities();
                return {
                    structuredContent: report,
                    content: [{ type: "text", text: JSON.stringify(report) }],
                };
            } catch {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                code: "PROVIDER_UNAVAILABLE",
                            }),
                        },
                    ],
                };
            }
        },
    );
    for (const tool of [
        "run_inference",
        "get_request",
        "cancel_request",
    ] as const) {
        server.registerTool(
            tool,
            {
                description:
                    "Perform a buyer-authorized operation using a signed platform grant and fresh buyer proof. Connectivity alone grants no inference access.",
                inputSchema: z
                    .object({
                        grant: z.unknown(),
                        proof: z.unknown(),
                        payload: z.unknown(),
                    })
                    .strict(),
            },
            async (request) => {
                try {
                    const response = await adapter.operation(tool, request);
                    return {
                        structuredContent: response as Record<string, unknown>,
                        content: [
                            { type: "text", text: JSON.stringify(response) },
                        ],
                    };
                } catch (error) {
                    const codes = new Set([
                        "QUEUE_FULL",
                        "RATE_LIMITED",
                        "PROVIDER_UNAVAILABLE",
                        "CONTEXT_TOO_LARGE",
                        "GRANT_LIMIT_EXCEEDED",
                        "INVALID_PLATFORM_GRANT",
                        "IDENTITY_MISMATCH",
                        "OPERATION_BINDING_MISMATCH",
                        "EXECUTION_BINDING_MISMATCH",
                        "REQUEST_NOT_FOUND",
                        "REQUEST_BINDING_MISMATCH",
                        "REPLAYED_OPERATION",
                        "PERSISTENCE_UNCERTAIN",
                    ]);
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    code:
                                        error instanceof Error &&
                                        codes.has(error.message)
                                            ? error.message
                                            : "OPERATION_REJECTED",
                                }),
                            },
                        ],
                    };
                }
            },
        );
    }
    return server;
}
