import { serviceUrl } from "@panas/contracts/service-url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const url =
    process.env.PANAS_REGISTRY_URL ?? "https://panas.mcpwire.co/registry";
const token = process.env.PANAS_DISCOVERY_TOKEN;
if (!url || !token)
    throw new Error(
        "Set PANAS_REGISTRY_URL and PANAS_DISCOVERY_TOKEN in a private environment file",
    );
const client = new Client({
    name: "panas-discovery-example",
    version: "0.1.0",
});
await client.connect(
    new StreamableHTTPClientTransport(serviceUrl(url, "/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
);
try {
    console.log(
        JSON.stringify(
            await client.callTool({
                name: "discover_providers",
                arguments: { readyOnly: true, limit: 10 },
            }),
            null,
            2,
        ),
    );
} finally {
    await client.close();
}
