import { z } from "zod";
import { atomicAmountSchema } from "@panas/contracts";

import { DEVNET_USDC_MINT } from "@panas/contracts/payments";
export { DEVNET_USDC_MINT } from "@panas/contracts/payments";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const devnetConfigSchema = z
    .object({
        rpcUrl: z
            .url()
            .refine(
                (v) =>
                    new URL(v).protocol === "https:" &&
                    !new URL(v).username &&
                    !new URL(v).password,
            ),
        treasuryOwner: address,
        treasuryTokenAccount: address,
    })
    .strict();
export type DevnetConfig = z.infer<typeof devnetConfigSchema>;
export const fundingIntentInputSchema = z
    .object({
        intentId: z.uuid().transform((v) => v.toLowerCase()),
        amountAtomic: atomicAmountSchema.refine(
            (v) => BigInt(v) > 0n && BigInt(v) <= 100000000n,
        ),
    })
    .strict();
export const fundingConfirmationSchema = z
    .object({
        intentId: z.uuid().transform((v) => v.toLowerCase()),
        signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
    })
    .strict();
export interface FundingIntent {
    intentId: string;
    buyerId: string;
    amountAtomic: string;
    memo: string;
    treasuryOwner: string;
    treasuryTokenAccount: string;
    createdAt: string;
    expiresAt: string;
}
const balance = z.object({
    accountIndex: z.number().int().nonnegative(),
    mint: z.string(),
    owner: z.string().optional(),
    uiTokenAmount: z.object({
        amount: atomicAmountSchema,
        decimals: z.number().int(),
    }),
});
const transaction = z.object({
    blockTime: z.number().int(),
    slot: z.number().int().nonnegative(),
    transaction: z.object({
        signatures: z.array(z.string()),
        message: z.object({
            accountKeys: z.array(z.object({ pubkey: z.string() })),
            instructions: z.array(z.unknown()),
        }),
    }),
    meta: z.object({
        err: z.null(),
        preTokenBalances: z.array(balance),
        postTokenBalances: z.array(balance),
        innerInstructions: z
            .array(z.object({ instructions: z.array(z.unknown()) }))
            .nullable()
            .optional(),
    }),
});
/** Trusted operator RPC, pinned devnet genesis/mint, finalized transfers only. No signing key. */
export class SolanaDevnetVerifier {
    readonly config: DevnetConfig;
    constructor(
        config: DevnetConfig,
        private readonly request: typeof fetch = fetch,
    ) {
        this.config = devnetConfigSchema.parse(config);
    }
    private async rpc(method: string, params: unknown[]) {
        const response = await this.request(this.config.rpcUrl, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("DEVNET_RPC_UNAVAILABLE");
        const text = await response.text();
        if (Buffer.byteLength(text) > 2000000)
            throw new Error("DEVNET_RPC_RESPONSE_TOO_LARGE");
        const result = z
            .object({
                jsonrpc: z.literal("2.0"),
                id: z.literal(1),
                result: z.unknown(),
                error: z.unknown().optional(),
            })
            .parse(JSON.parse(text));
        if (result.error) throw new Error("DEVNET_RPC_REJECTED");
        return result.result;
    }
    async verify(intent: FundingIntent, signature: string) {
        fundingConfirmationSchema.parse({
            intentId: intent.intentId,
            signature,
        });
        if (
            intent.treasuryOwner !== this.config.treasuryOwner ||
            intent.treasuryTokenAccount !== this.config.treasuryTokenAccount
        )
            throw new Error("DEVNET_TREASURY_CHANGED");
        if ((await this.rpc("getGenesisHash", [])) !== DEVNET_GENESIS)
            throw new Error("DEVNET_REQUIRED");
        const value = transaction.parse(
            await this.rpc("getTransaction", [
                signature,
                {
                    commitment: "finalized",
                    encoding: "jsonParsed",
                    maxSupportedTransactionVersion: 0,
                },
            ]),
        );
        if (
            value.transaction.signatures[0] !== signature ||
            value.blockTime * 1000 < Date.parse(intent.createdAt) - 5000 ||
            value.blockTime * 1000 > Date.parse(intent.expiresAt)
        )
            throw new Error("DEVNET_TRANSACTION_BINDING_MISMATCH");
        const index = value.transaction.message.accountKeys.findIndex(
            (v) => v.pubkey === intent.treasuryTokenAccount,
        );
        const post = value.meta.postTokenBalances.find(
            (v) => v.accountIndex === index,
        );
        const pre = value.meta.preTokenBalances.find(
            (v) => v.accountIndex === index,
        );
        if (
            !post ||
            post.mint !== DEVNET_USDC_MINT ||
            post.owner !== intent.treasuryOwner ||
            post.uiTokenAmount.decimals !== 6 ||
            (pre &&
                (pre.mint !== DEVNET_USDC_MINT ||
                    pre.owner !== intent.treasuryOwner ||
                    pre.uiTokenAmount.decimals !== 6)) ||
            BigInt(post.uiTokenAmount.amount) -
                BigInt(pre?.uiTokenAmount.amount ?? "0") !==
                BigInt(intent.amountAtomic)
        )
            throw new Error("DEVNET_TOKEN_BALANCE_MISMATCH");
        const all = [
            ...value.transaction.message.instructions,
            ...(value.meta.innerInstructions ?? []).flatMap(
                (v) => v.instructions,
            ),
        ];
        const instructions = all
            .map((v) =>
                z
                    .object({
                        programId: z.string(),
                        parsed: z.unknown().optional(),
                    })
                    .passthrough()
                    .safeParse(v),
            )
            .filter((v) => v.success)
            .map((v) => v.data!);
        const memos = instructions.filter((v) => v.programId === MEMO_PROGRAM);
        if (memos.length !== 1 || memos[0]!.parsed !== intent.memo)
            throw new Error("DEVNET_MEMO_MISMATCH");
        const transfers = instructions
            .filter((v) => v.programId === TOKEN_PROGRAM)
            .map((v) =>
                z
                    .object({
                        type: z.literal("transferChecked"),
                        info: z.object({
                            mint: z.literal(DEVNET_USDC_MINT),
                            destination: z.string(),
                            tokenAmount: z.object({
                                amount: atomicAmountSchema,
                                decimals: z.literal(6),
                            }),
                        }),
                    })
                    .safeParse(v.parsed),
            )
            .filter((v) => v.success)
            .map((v) => v.data!);
        const matching = transfers.filter(
            (v) => v.info.destination === intent.treasuryTokenAccount,
        );
        if (
            matching.length !== 1 ||
            matching[0]!.info.tokenAmount.amount !== intent.amountAtomic
        )
            throw new Error("DEVNET_TRANSFER_MISMATCH");
        return {
            signature,
            slot: value.slot,
            currency: "SOLANA_DEVNET_USDC" as const,
            amountAtomic: intent.amountAtomic,
            mint: DEVNET_USDC_MINT,
            network: "solana-devnet" as const,
        };
    }
}
