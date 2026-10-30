# Free access and Solana devnet USDC

Providers choose their terms. `panas provider --free` publishes a zero price; `panas provider --solana-devnet --price-atomic 10000` publishes 0.01 devnet USDC per bounded successful request. Existing internal TEST_CREDIT pricing remains a regression/testing rail. Public listings display **Free** or an exact decimal **devnet USDC** amount. Agent discovery accepts `currency`; a nonzero price filter without a currency retains TEST_CREDIT semantics. Free providers can be returned for any currency.

Free requests use signed, startup-bound grants and the normal one-worker/rate/queue/deadline/replay rules. They do not need a crypto wallet, funded balance or positive spending budget. The platform fee is also zero. Accepting a free quote through `purchase_access` only obtains execution authority; the completed receipt has zero debit, earnings and fee and no settlement ledger entries. Operator enrollment and a valid enabled identity/session still apply.

## Paid demo flow

The initial blockchain rail is **prepaid Solana devnet USDC**, not mainnet. Circle identifies mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` as its [Solana devnet test token](https://developers.circle.com/stablecoins/usdc-contract-addresses); these tokens have no real financial value. Amounts are integer atomic units with six decimals. `10000` means `0.01` test USDC.

1. The operator enrolls a separate buyer with `currency: "SOLANA_DEVNET_USDC"`, owner-selected atomic spending caps and a session. The buyer config also contains `currency: "SOLANA_DEVNET_USDC"`. An existing account's asset cannot be changed. No currency conversion or mixing with TEST_CREDIT is supported.
2. The buyer calls `create_funding_intent({intentId, amountAtomic})` using a fresh UUID. Reusing that UUID with the same terms returns the same intent. Each account has at most ten open unexpired intents. A deposit is capped at 100 test USDC.
3. The owner sends exactly that amount with one SPL Token `transferChecked` to the returned treasury token account, plus one Memo-program instruction containing the exact returned memo. Use the DEVNET network and canonical mint. A transfer can create the ATA in the same transaction. A plain token transfer without the required memo is not automatically credited; operators must review it. No wallet seed/private key belongs in MCP arguments, prompts or cloud configuration.
4. The buyer submits the public signature through `confirm_funding({intentId, signature})`. Accounting independently checks the configured RPC's full devnet genesis hash, finalized transaction success, first signature, timestamp, canonical mint/program/decimals, exact transfer and net recipient balance increase, treasury owner/account and buyer-bound memo. A signature cannot credit two intents. Expired unpaid intents are not renewed; an original transfer made within its validity window can still be confirmed later. Do not rotate the configured treasury while deposits to it remain unresolved. Receipt verification is not a client-provided `paid: true` claim.
5. One confirmed deposit credits the prepaid balance exactly once in its original asset. Paid inference then uses the existing quote/reserve/authorize/complete/receipt flow. Only durable completion settles buyer debit, provider earnings and disclosed fee. Failed/cancelled requests release the reservation; approved refunds restore the prepaid balance in the same asset. Transport failures never trigger automatic execution replay.

Deposit verification contains no signing key and cannot spend the treasury. RPC calls occur before acquiring financial row locks. Database constraints, immutable account currency and a ledger asset guard prevent an old or buggy funding path from inserting TEST_CREDIT into a devnet-USDC account. Ledger history is not converted or rewritten.

This implements a prepaid paywall and accounting of provider earnings. **Automated on-chain provider payouts and wallet withdrawals are not implemented.** Restoring a prepaid balance is distinct from sending a token refund to a wallet. Deposit network fees are separate from the inference price and are not refunded by this ledger. A production payment rollout needs an explicit withdrawal/payout process and custody/refund policy; mainnet remains disabled.

## Enable the devnet backend

Apply migrations 047–051 and deploy the matching registry/accounting/web source before enrolling token buyers or advertising paid providers. Existing deployed alpha.2 services do not implement the funding routes or new currency. Configure these accounting environment variables using **public** treasury information only:

```sh
PANAS_SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
PANAS_SOLANA_DEVNET_TREASURY_OWNER=DEVNET_WALLET_PUBLIC_ADDRESS
PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT=DEVNET_USDC_TOKEN_ACCOUNT
```

Both treasury fields are required; missing configuration leaves funding unavailable. The deployment script initializes missing public devnet values from `volcano/devnet-payments.json` and preserves existing operator settings. That file binds only the separately generated demo treasury; no keypair or mainnet payment setting is uploaded. Never upload a treasury keypair, seed or mainnet signing key. The verifier rejects another cluster even if the operator accidentally points the URL at mainnet. Inference stays on the Mac. The treasury's private signing key should stay outside the provider environment.

The operator provides mode0600 `~/.config/panas/buyer-usdc.env` referencing the separate token buyer config. `panas demo-prompt --paid` prints the matching Codex setup/funding/test instructions. The default `panas demo-prompt` uses only free providers and authorizes no spending.

## Treasury generation and custody

`pnpm treasury:create --out /absolute/new/private/directory` generates two independent real Solana keypairs: a mainnet-capable candidate and a separate devnet treasury. It uses the pinned official Solana Kit, stores standard 64-byte keypair JSON with mode0600 under mode0700 directories, verifies local restore/signature behavior and derives the corresponding canonical USDC ATA addresses. Existing directories/keys are never overwritten. Output/public manifest contain addresses and file locations only. No blockchain transaction is sent, and deriving an ATA does not create the on-chain account.

A key generated/stored on this unsandboxed Mac is software custody, **not production-ready custody**. Back up the key files in an encrypted offline location, verify restoration and arrange a hardware-backed or multisig treasury under human control before real funds. Never paste private key files into chat, Git, a model prompt, a release asset or a provider configuration. The mainnet candidate is never used by the devnet demo. See the private generated README locally; public assets contain no treasury keys.

## Verification boundary

`pnpm test:accounting-db` applies migrations only to an explicitly configured local `panas_*test` database and runs actual Postgres authorization/ledger cases. CI provides PostgreSQL 18 for this check. RPC fixtures test valid and adversarial finalized-transfer responses; they are not evidence of a live on-chain payment. Keep actual mint/cluster reads, an actual funded transfer and actual inference/receipt evidence distinct. Do not claim that a generated unfunded wallet or a passing fixture is a funded production treasury.

`get_balance` reports the owned account asset, available prepaid funds, and remaining cloud request/session/daily spending authority. Funding never increases those limits. Check it before asking the owner for a deposit.
