import { describe, it, expect } from "vitest";
import {
    SolanaDevnetVerifier,
    DEVNET_GENESIS,
    DEVNET_USDC_MINT,
} from "./solana-devnet";
import {
    devnetFixtureIntent,
    fixtureSignature,
    devnetFixtureTransaction,
} from "./devnet-test-fixtures";
describe("devnet-USDC receipt verification (injected RPC; not an on-chain transfer)", () => {
    const config = {
        rpcUrl: "https://api.devnet.solana.com",
        treasuryOwner: devnetFixtureIntent.treasuryOwner,
        treasuryTokenAccount: devnetFixtureIntent.treasuryTokenAccount,
    };
    const make = (tx: unknown, genesis = DEVNET_GENESIS) =>
        new SolanaDevnetVerifier(config, async (_url, options) => {
            const body = JSON.parse(String(options?.body));
            if (body.method === "getTransaction")
                expect(body.params[1]).toEqual({
                    commitment: "finalized",
                    encoding: "jsonParsed",
                    maxSupportedTransactionVersion: 0,
                });
            return Response.json({
                jsonrpc: "2.0",
                id: 1,
                result: body.method === "getGenesisHash" ? genesis : tx,
            });
        });
    it("accepts only a finalized, exact, buyer-memo-bound transfer to the configured devnet treasury", async () => {
        const proof = await make(devnetFixtureTransaction()).verify(
            devnetFixtureIntent,
            fixtureSignature,
        );
        expect(proof).toMatchObject({
            amountAtomic: "10000",
            currency: "SOLANA_DEVNET_USDC",
            mint: DEVNET_USDC_MINT,
            signature: fixtureSignature,
        });
    });
    it("rejects another cluster, failed/unconfirmed transaction, wrong token/recipient/amount/memo/time/signature and missing transfer", async () => {
        await expect(
            make(devnetFixtureTransaction(), "mainnet-genesis").verify(
                devnetFixtureIntent,
                fixtureSignature,
            ),
        ).rejects.toThrow("DEVNET_REQUIRED");
        const variants: unknown[] = [
            null,
            {
                ...devnetFixtureTransaction(),
                meta: { err: { InstructionError: [0, "Custom"] } },
            },
        ];
        for (const change of [
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.meta.postTokenBalances[0]!.mint = "fake-token";
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.meta.postTokenBalances[0]!.owner = "another-owner";
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.meta.postTokenBalances[0]!.uiTokenAmount.amount = "9999";
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.transaction.message.instructions.pop();
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.transaction.message.instructions.shift();
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.blockTime += 3600;
            },
            (v: ReturnType<typeof devnetFixtureTransaction>) => {
                v.transaction.signatures = ["4".repeat(88)];
            },
        ]) {
            const v = devnetFixtureTransaction();
            change(v);
            variants.push(v);
        }
        for (const value of variants)
            await expect(
                make(value).verify(devnetFixtureIntent, fixtureSignature),
            ).rejects.toThrow();
    });
});
