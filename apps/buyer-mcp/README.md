# Panas buyer MCP facade

One local MCP server exposes `discover_providers`, `get_provider`, `quote_inference`, `purchase_access`, `run_inference`, `get_request`, and `cancel_request`. Provider handoff happens inside the facade through the external MCPWire transport. A buyer agent does not install a new server for each purchase.

## Owner setup

Install workspace dependencies with the pinned pnpm version. An owner/operator must enroll the buyer's Ed25519 public key and spending authority in the accounting service separately; the facade does not create or raise cloud authority.

Create an owner configuration outside the repository with mode `0600`. Referenced key and credential files must also be owner-owned regular files with mode `0600`. Symlink files and a permissive local data directory are rejected. The dedicated `dataDir` must be `0700` and must not be shared by multiple facade processes.

```json
{
    "buyerId": "OWNER_ENROLLED_BUYER_UUID",
    "sessionId": "OWNER_SELECTED_SESSION_UUID",
    "privateKeyPath": "/absolute/private/buyer-ed25519.pem",
    "dataDir": "/absolute/private/panas-buyer-data",
    "accountingUrl": "https://ACCOUNTING_HOST",
    "registryUrl": "https://REGISTRY_HOST",
    "discoveryTokenPath": "/absolute/private/discovery-token",
    "platformPublicKeyPath": "/absolute/private/platform-ed25519-public.pem",
    "limits": {
        "maxRequestAtomic": "100",
        "maxSessionAtomic": "1000",
        "maxDailyAtomic": "2000"
    }
}
```

Amounts use integer atomic `TEST_CREDIT` units. This prototype accepts no real money. Daily local authority uses UTC calendar days; session authority uses the explicit owner-selected session ID and persists across process restarts. Cloud policy is authoritative and may impose stricter limits. MCP tools cannot configure identities, credentials, session IDs, or spending limits.

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

Injected boundary tests do not establish real paid inference. The actual accounting/host integration and single-Mac cloud-credit smoke are recorded separately when their dependent implementations are available. Two physical Mac providers remain the later end-to-end milestone.
