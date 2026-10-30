import {
    DEVNET_USDC_MINT,
    TOKEN_PROGRAM,
    MEMO_PROGRAM,
    type FundingIntent,
} from "./solana-devnet";
export const devnetFixtureIntent: FundingIntent = {
    intentId: "00000000-0000-4000-8000-000000000001",
    buyerId: "00000000-0000-4000-8000-000000000002",
    amountAtomic: "10000",
    memo: "panas-devnet:00000000-0000-4000-8000-000000000001",
    treasuryOwner: "11111111111111111111111111111111",
    treasuryTokenAccount: "22222222222222222222222222222222",
    createdAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-10-29T00:30:00.000Z",
};
export const fixtureSignature = "3".repeat(88);
export function devnetFixtureTransaction(
    intent = devnetFixtureIntent,
    signature = fixtureSignature,
) {
    return {
        blockTime: Math.floor(Date.parse(intent.createdAt) / 1000) + 10,
        slot: 123,
        transaction: {
            signatures: [signature],
            message: {
                accountKeys: [{ pubkey: intent.treasuryTokenAccount }],
                instructions: [
                    {
                        programId: TOKEN_PROGRAM,
                        parsed: {
                            type: "transferChecked",
                            info: {
                                mint: DEVNET_USDC_MINT,
                                destination: intent.treasuryTokenAccount,
                                tokenAmount: {
                                    amount: intent.amountAtomic,
                                    decimals: 6,
                                },
                            },
                        },
                    },
                    { programId: MEMO_PROGRAM, parsed: intent.memo },
                ],
            },
        },
        meta: {
            err: null,
            preTokenBalances: [],
            postTokenBalances: [
                {
                    accountIndex: 0,
                    mint: DEVNET_USDC_MINT,
                    owner: intent.treasuryOwner,
                    uiTokenAmount: { amount: intent.amountAtomic, decimals: 6 },
                },
            ],
            innerInstructions: [],
        },
    };
}
