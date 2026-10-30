ALTER TABLE panas_accounting_buyers ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TEST_CREDIT' CHECK(currency IN ('TEST_CREDIT','SOLANA_DEVNET_USDC'));
ALTER TABLE panas_accounting_ledger DROP CONSTRAINT IF EXISTS panas_accounting_ledger_currency_check;
ALTER TABLE panas_accounting_ledger ADD CONSTRAINT panas_accounting_ledger_currency_check CHECK(currency IN ('TEST_CREDIT','SOLANA_DEVNET_USDC'));
