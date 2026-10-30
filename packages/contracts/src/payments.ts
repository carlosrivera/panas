import { z } from "zod";
import { atomicAmountSchema } from "./money.js";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const devnetFundingSchema = z
    .object({
        intentId: z.uuid(),
        buyerId: z.uuid(),
        currency: z.literal("SOLANA_DEVNET_USDC"),
        network: z.literal("solana-devnet"),
        mint: z.literal(DEVNET_USDC_MINT),
        decimals: z.literal(6),
        amountAtomic: atomicAmountSchema.refine(
            (v) => BigInt(v) > 0n && BigInt(v) <= 100000000n,
        ),
        memo: z.string(),
        treasuryOwner: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        treasuryTokenAccount: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        funded: z.boolean(),
        signature: z.string().nullable(),
    })
    .strict()
    .refine(
        (v) =>
            v.memo === `panas-devnet:${v.intentId}` &&
            Date.parse(v.expiresAt) > Date.parse(v.createdAt),
        "Invalid funding intent binding",
    );
