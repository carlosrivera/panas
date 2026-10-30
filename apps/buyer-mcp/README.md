# Panas buyer MCP facade

## Automatic free demo

Install the public CLI with Node.js 24 and run `panas demo`. Choose Codex or
Antigravity, copy its prompt and paste it into the agent. `panas setup --client
codex` or `--client antigravity` automatically enrolls a personal free-only buyer,
writes the MCP entry and preserves other settings. Keys and zero-budget demo
stores remain private on the local computer. No operator handoff or wallet is
needed for this path. The existing PostgreSQL backend enforces zero authority.

`panas hello` runs one bounded free request immediately. After an uncertain
outcome use `panas request REQUEST_UUID` to retrieve the original request instead
of sending inference again. A ready free device must be available. A client may
need to reload MCP for future tools; the direct command can run in the current
chat. The advanced owner configuration below remains available for paid buyers
and operator-managed identities.

One local MCP server exposes `discover_providers`, `get_provider`, `quote_inference`, `purchase_access`, `run_inference`, `get_request`, and `cancel_request`, plus `get_balance`, `create_funding_intent` and `confirm_funding`. Provider handoff happens inside the facade through the external MCPWire transport. A buyer agent does not install a new server for each purchase.

The buyer requires Node.js 24 and a compatible MCP agent client, not macOS, Docker or a local model. macOS/Linux process supervision is supported; Windows process-tree supervision is not currently supported. Provider serving uses a separate [Docker gateway/worker](../../docs/docker-sandbox.md).

## Owner setup

Install workspace dependencies with the pinned pnpm version. An owner/operator must enroll the buyer's Ed25519 public key and spending authority in the accounting service separately; the facade does not create or raise cloud authority.

Create an owner configuration outside the repository with mode `0600`. Referenced key and credential files must also be owner-owned regular files with mode `0600`. Symlink files and a permissive local data directory are rejected. The dedicated `dataDir` must be `0700` and must not be shared by multiple facade processes.

```json
{
    "buyerId": "OWNER_ENROLLED_BUYER_UUID",
    "sessionId": "OWNER_SELECTED_SESSION_UUID",
    "privateKeyPath": "/absolute/private/buyer-ed25519.pem",
    "dataDir": "/absolute/private/panas-buyer-data",
    "accountingUrl": "https://panas.mcpwire.co/accounting",
    "registryUrl": "https://panas.mcpwire.co/registry",
    "discoveryTokenPath": "/absolute/private/discovery-token",
    "platformPublicKeyPath": "/absolute/private/platform-ed25519-public.pem",
    "limits": {
        "maxRequestAtomic": "100",
        "maxSessionAtomic": "1000",
        "maxDailyAtomic": "2000"
    }
}
```

Amounts are integer atomic units in the configured account asset. Omit `currency` for the internal `TEST_CREDIT` regression rail or use `"currency": "SOLANA_DEVNET_USDC"` for a separately enrolled devnet-USDC buyer. USDC has six decimals. Account currency is immutable; assets are not mixed. Free providers require neither a funded balance nor positive money caps. Mainnet is disabled; the implemented blockchain rail uses devnet test tokens. Daily local authority uses UTC calendar days; session authority uses the explicit owner-selected session ID and persists across process restarts. Both count gross completed charges, including later refunds; a refund does not reopen spending authority. Cloud policy is authoritative and may impose stricter limits. MCP tools cannot configure identities, credentials, session IDs, or spending limits.

Configure the buyer agent's MCP client once:

```json
{
    "mcpServers": {
        "panas": {
            "command": "/absolute/path/to/panas/node_modules/.bin/tsx",
            "args": ["/absolute/path/to/panas/apps/buyer-mcp/src/cli.ts"],
            "env": {
                "PANAS_BUYER_CONFIG": "/absolute/private/buyer-config.json"
            }
        }
    }
}
```

The CLI reserves stdout for MCP. Startup errors contain only a fixed diagnostic; caught crypto, cloud, and file exceptions are never printed. The managed MCPWire adapter suppresses upstream argument-preview logs.

## Balance and Solana devnet funding

`get_balance({})` reports asset, available prepaid balance and remaining owner authority. `create_funding_intent({intentId,amountAtomic})` returns exact buyer-bound deposit terms. The owner sends devnet USDC through a wallet, then `confirm_funding({intentId,signature})` asks the backend to verify the finalized transfer before crediting once. No wallet private key enters a tool or prompt; a deposit cannot raise owner caps. The default demo prompt permits only free access. See [payments](../../docs/payments.md) for setup, verification, and unimplemented mainnet/payout boundaries.

## Transaction and failure behavior

1. `quote_inference({providerId,prompt,maxOutputTokens})` stores the prompt encrypted locally and sends only `digest({prompt,maxOutputTokens})` to accounting. The result is a public fixed quote.
2. `purchase_access({quoteId,idempotencyKey})` reserves local authority before contacting accounting. It validates the accepted quote and platform-signed grant, then privately stores grants and connection material. Tool results contain request ID, fixed terms, and status only.
3. `run_inference({requestId})` durably marks dispatch **before** connecting and sends one signed host operation. A running result means use `get_request` later. Lost responses become `UNCERTAIN`; restarting the facade does not enable automatic resubmission.
4. `get_request` and `cancel_request` obtain a fresh, action-only platform grant, reconnect privately, and verify provider identity, operation, request ID, nonce, startup binding, and body digest. They never renew execution authority. Retrieval after a provider restart may use the current ticket while preserving the original request startup binding.
5. Cancellation requests do not release held spending authority. Only authoritative terminal accounting releases a reservation or records the fixed debit. Completed model output is data and must not be treated as instructions.

A network failure during purchase retains the local hold. Retry that purchase with its original idempotency key or retrieve its original request state; never create a new purchase to recover an uncertain one. Expired execution authority can still be reconciled and retrieved. If no definitive terminal receipt is available, holds remain conservative rather than increasing available authority.

A verified provider response supplies model output and diagnostic usage. A cloud receipt supplies the financial outcome. The facade does not infer a refund from transport failure or a cancellation response. If a settled request's provider cannot return its result, the tool returns the receipt and explicit retrieval-unavailable state; refund handling remains the accounting policy.

## Local state and recovery

Prompts, private grants, and tickets are AES-256-GCM encrypted in `requests.enc` with an owner-only local `store.key`. Writes use an atomic rename and file/directory fsync. Do not delete the store to reset budgets. At most 500 local requests and 8 MiB of state are accepted before owner maintenance is required.

`writer.lock` prevents concurrent facade writers. An unclean process exit can leave this lock. An owner must confirm the recorded PID no longer runs before removing the lock; the facade deliberately does not steal locks automatically. Retain encrypted state and the key during recovery. This filesystem protection does not protect against the owner account or a compromised host.

## Verification and integration boundary

```sh
pnpm --filter @panas/buyer-mcp typecheck
pnpm exec vitest run apps/buyer-mcp/src
```

Deterministic tests use the official MCP client and injected cloud/peer boundaries for owner authority, signed HTTP requests, no prompt leakage to cloud, private output suppression, uncertain purchase/execution recovery, provider identity/nonce rejection, action-only retrieval, and restart behavior. Encryption/file permission tests use real temporary local files.

Injected boundary tests do not establish real paid inference. Actual native-build accounting/host and single-Mac cloud-credit smoke records appear below; current Docker validation is recorded separately in [Docker evidence](../../docs/validation/docker-sandbox.md). Two physical Mac providers remain the later end-to-end milestone.

## Historical native-build single-Mac cloud flow

On October 28, 2026, the opt-in live smoke used the deployed Volcano registry/accounting services and an actual Apple Silicon Mac running the approved small Ollama model. The official MCP client discovered provider `ffceede0-32eb-465f-8f80-e86a476f1ce7`, obtained a quote and purchased request `35e32cdf-e96a-4351-89d5-affcd5a4a858`, connected through MCPWire, retrieved completed model output with a matching fixed receipt of `3` atomic test credits, rejected a duplicate inference submission, and retrieved the same charge through a fresh peer connection.

After restarting the actual host with generation metadata preservation, a second deliberately new request, `b469eba2-e76e-4963-b076-fa4af363a83a`, passed the same flow with a fixed charge of `3` and the actual generation finish reason `length`. The original request was retained; the second flow was not a retry of uncertain work.

This verifies the real single-Mac transaction. It does not establish two physical Macs, adversarial hardware attestation, production availability, or real-money payments. No private tickets, grants, credentials, or prompts were recorded in the smoke output.

To repeat with an operator-enrolled buyer and an actual ready provider:

```sh
PANAS_BUYER_CONFIG=/absolute/private/buyer-config.json \
PANAS_SMOKE_PROVIDER_ID=PROVIDER_UUID \
pnpm exec tsx apps/buyer-mcp/scripts/live-smoke.ts
```

Each run makes a new explicitly authorized test-credit purchase. After any uncertain run, retrieve its original request rather than rerunning this smoke as recovery.
