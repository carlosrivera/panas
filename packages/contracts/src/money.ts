import { z } from "zod";
export const paymentCurrencySchema = z.enum([
    "TEST_CREDIT",
    "SOLANA_DEVNET_USDC",
]);
export type PaymentCurrency = z.infer<typeof paymentCurrencySchema>;
export const atomicAmountSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
