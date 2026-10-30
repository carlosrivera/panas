# Free access and devnet funding validation

The one-Mac free drill used a development alpha.3 build (before the balance-inspection tool was added), the existing deployed Volcano control plane, a real native Ollama worker and a newly enrolled buyer with balance, held funds and owner spending caps all zero. No operator funding or wallet transfer was performed. Discovery, signed purchase and one peer inference completed with generated output and an authoritative zero-charge receipt:

- Request: `cca45110-f789-419b-be31-dfbb88b21057`
- Receipt: `1f778b52-962a-4ffb-bbb8-2334a4823799`
- Completed: `2026-10-30T02:18:54.576Z`
- Buyer debit / provider earnings / fee: `0 / 0 / 0` (nominal `TEST_CREDIT` accounting unit)
- Actual token usage: 10 input / 32 output tokens.

The supervised native provider was stopped afterwards. Native process supervision is not an OS sandbox.

The repository checks pass. Real isolated Postgres tests cover a zero-balance free purchase with a nonzero configured platform fee, asset-bound accounts and ledgers, concurrent deposit confirmations crediting once, immutable funding terms and proofs, same-asset settlement/refund, and owner-bound balance/remaining-authority lookup. Registry Postgres tests cover asset-filtered prices and free-provider eligibility. Solana verifier tests use injected RPC responses, including wrong cluster/mint/owner/amount/memo, failed transactions and unavailable finality.

Read-only calls to the real Solana devnet RPC verified its genesis hash and the canonical initialized six-decimal USDC mint. **No real devnet USDC transfer, funded paid inference, automated provider payout or mainnet payment was performed.** The public treasury token account is derived but not created. A funded paid drill requires deploying migrations 047–051 and matching services, enrolling a separate devnet-USDC buyer, creating/funding the treasury token account and submitting an actual finalized transfer with the exact intent memo. Mainnet custody and wallet payouts remain tracked in issue #49.
