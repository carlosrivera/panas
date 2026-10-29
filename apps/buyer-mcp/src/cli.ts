import { createPrivateKey, createPublicKey } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readOwnerConfig, readPrivateFile } from "./config";
import {
    createCloudClient,
    createDiscoveryClient,
    createPeerClient,
} from "./clients";
import { PrivateStore } from "./store";
import { buyerStateSchema } from "./state";
import { BuyerService } from "./service";
import { createBuyerMcp } from "./mcp";

async function main() {
    const path = process.env.PANAS_BUYER_CONFIG;
    if (!path) throw new Error("Missing owner configuration");
    const owner = readOwnerConfig(path);
    const privateKey = createPrivateKey(readPrivateFile(owner.privateKeyPath));
    const platformPublicKey = createPublicKey(
        readPrivateFile(owner.platformPublicKeyPath),
    );
    const discoveryToken = readPrivateFile(owner.discoveryTokenPath)
        .toString("utf8")
        .trim();
    if (!discoveryToken || /\s/.test(discoveryToken))
        throw new Error("Invalid private discovery credential");
    const store = new PrivateStore(
        owner.dataDir,
        (value) => buyerStateSchema.parse(value),
        () => ({ version: 1 as const, buyerId: owner.buyerId, requests: {} }),
    );
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
            discovery: createDiscoveryClient({
                url: owner.registryUrl,
                token: discoveryToken,
            }),
            peer: createPeerClient(),
        }),
    );
    let stopping = false;
    const close = async () => {
        if (stopping) return;
        stopping = true;
        try {
            await server.close();
        } finally {
            store.close();
        }
    };
    process.once("SIGINT", () => {
        void close().finally(() => process.exit(0));
    });
    process.once("SIGTERM", () => {
        void close().finally(() => process.exit(0));
    });
    process.stdin.once("end", () => {
        void close();
    });
    try {
        await server.connect(new StdioServerTransport());
    } catch (error) {
        await close();
        throw error;
    }
}
void main().catch(() => {
    // Never print caught exceptions: infrastructure and crypto errors can contain private values.
    process.stderr.write(
        "Panas buyer could not start. Verify owner-only configuration and local store permissions.\n",
    );
    process.exitCode = 1;
});
