/** Opt-in: real cloud test credits + a real separately supervised local Mac provider. */
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { readOwnerConfig, readPrivateFile } from "../src/config";
import {
    createCloudClient,
    createDiscoveryClient,
    createPeerClient,
} from "../src/clients";
import { buyerStateSchema } from "../src/state";
import { PrivateStore } from "../src/store";
import { BuyerService } from "../src/service";
import { createBuyerMcp } from "../src/mcp";

let stage = "startup";
async function main() {
    const configPath = process.env.PANAS_BUYER_CONFIG;
    if (!configPath)
        throw new Error(
            "Set PANAS_BUYER_CONFIG to an owner-only configuration before real test-credit smoke",
        );
    const owner = readOwnerConfig(configPath);
    const privateKey = createPrivateKey(readPrivateFile(owner.privateKeyPath));
    const platformPublicKey = createPublicKey(
        readPrivateFile(owner.platformPublicKeyPath),
    );
    const token = readPrivateFile(owner.discoveryTokenPath)
        .toString("utf8")
        .trim();
    const store = new PrivateStore(
        owner.dataDir,
        (value) => buyerStateSchema.parse(value),
        () => ({ version: 1 as const, buyerId: owner.buyerId, requests: {} }),
    );
    const peer = createPeerClient();
    const server = createBuyerMcp(
        new BuyerService({
            owner,
            privateKey,
            platformPublicKey,
            store,
            cloud: createCloudClient({
                url: owner.accountingUrl,
                buyerId: owner.buyerId,
                privateKey,
            }),
            discovery: createDiscoveryClient({ url: owner.registryUrl, token }),
            peer,
        }),
    );
    const client = new Client({ name: "panas-real-buyer-smoke", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const invoke = async (name: string, args: Record<string, unknown>) => {
        stage = name;
        const result = await client.callTool({ name, arguments: args });
        if (result.isError)
            throw new Error(`Buyer ${name} failed; private details suppressed`);
        return z
            .record(z.string(), z.unknown())
            .parse(result.structuredContent);
    };
    try {
        await server.connect(a);
        await client.connect(b);
        const discovery = await invoke("discover_providers", {
            readyOnly: true,
            limit: 10,
        });
        const providers = z
            .array(
                z.object({
                    providerId: z.uuid(),
                    readiness: z.object({ ready: z.boolean() }),
                }),
            )
            .parse(discovery.providers);
        const provider = process.env.PANAS_SMOKE_PROVIDER_ID
            ? providers.find(
                  (item) =>
                      item.providerId === process.env.PANAS_SMOKE_PROVIDER_ID,
              )
            : providers.find((item) => item.readiness.ready);
        if (!provider)
            throw new Error(
                "No actual ready provider available; smoke did not purchase",
            );
        await invoke("get_provider", { providerId: provider.providerId });
        const quote = await invoke("quote_inference", {
            providerId: provider.providerId,
            prompt: "Reply with a brief greeting.",
            maxOutputTokens: 8,
        });
        const requestId = z.uuid().parse(quote.requestId);
        await invoke("purchase_access", {
            quoteId: quote.quoteId,
            idempotencyKey: randomUUID(),
        });
        await invoke("run_inference", { requestId });
        let final: Record<string, unknown> | undefined;
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            const state = await invoke("get_request", { requestId });
            if (state.status === "completed" && state.result && state.receipt) {
                final = state;
                break;
            }
            if (
                ["failed", "cancelled", "refunded"].includes(
                    String(state.status),
                )
            )
                throw new Error("Real inference did not complete successfully");
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (
            !final ||
            final.chargeAtomic !== quote.totalAtomic ||
            !["stop", "length"].includes(String(final.finishReason))
        )
            throw new Error(
                "Real request did not produce matching fixed-price receipt",
            );
        const duplicate = await client.callTool({
            name: "run_inference",
            arguments: { requestId },
        });
        if (!duplicate.isError)
            throw new Error("Duplicate run was not rejected");
        const retrieved = await invoke("get_request", { requestId });
        if (retrieved.chargeAtomic !== final.chargeAtomic)
            throw new Error("Reconnect changed the charge");
        console.log(
            JSON.stringify({
                status: "passed",
                requestId,
                providerId: provider.providerId,
                chargeAtomic: final.chargeAtomic,
                finishReason: final.finishReason,
                evidence:
                    "actual cloud test credits and one Mac provider via separate MCPWire peer processes",
            }),
        );
    } finally {
        await client.close();
        await server.close();
        await peer.close();
        store.close();
    }
}
void main().catch(() => {
    process.stderr.write(
        `Panas buyer live smoke failed at ${stage}; private diagnostics suppressed.\n`,
    );
    process.exitCode = 1;
});
