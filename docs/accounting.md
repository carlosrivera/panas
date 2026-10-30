# Fixed-price accounting and Solana devnet funding

`@panas/accounting` implements the financial authorization service shared by the provider host and buyer facade. It supports free access, prepaid **SOLANA_DEVNET_USDC**, and the internal **TEST_CREDIT** regression rail. Finalized devnet-USDC deposits credit asset-bound prepaid balances; mainnet, card payments, automated on-chain payouts and wallet withdrawals are not implemented. See [funding protocol and configuration](payments.md).

## Trust and authority

Buyers have operator-enrolled Ed25519 keys, a cached posted balance, owner request/session/daily limits, and owner-configured sessions. Buyer API calls cannot mint credits or raise any policy. The private operator CLI manages enrollment, limits, sessions, TEST_CREDIT fixture funding, and audited reconciliation; it requires a private database connection and must never be installed as a buyer agent tool.

Providers authenticate using their current enabled registry enrollment. Execution and terminal callbacks additionally bind to the provider key pinned in the purchased platform grant. Key rotation therefore blocks old in-flight callbacks until explicit operator reconciliation; an arbitrary new key cannot assert that old work succeeded. Previously authorized work can settle after buyer revocation, but new admission checks current buyer key/enabled state and owner session availability.

Every HTTP request supplies `X-Panas-Proof`, a base64url JSON `SignedDocument<CloudRequest>` from `@panas/protocol`. Sign `DOMAIN.cloud` with the actor's enrolled key. Bind actor, method, exact path, canonical body digest (`digest(null)` for GET), fresh UUID nonce, and a window of at most 120 seconds. Both signature/expiry and current key authority are checked; freshness is checked again after database locks. Nonces are durable and transactional. Retry an operation with a fresh HTTP proof and the same semantic idempotency identifier.

## Buyer API

- `POST /quotes`: `{providerId,sessionId,requestId,payloadDigest,maxOutputTokens}` → flat `Quote`.
- `POST /purchases`: `{quoteId,idempotencyKey}` → `{quote,signedGrant,descriptor}`.
- `GET /requests/{requestId}` → `{requestId,status,cancelRequested,reconcileAfter,receipt,signedGrant,descriptor?}`.
- `POST /requests/{requestId}/cancel`: `{}` → cancellation-request state; this does **not** release a running or uncertain hold.

The service receives only a payload digest and requested output bound, never the inference prompt. A quote binds buyer/session/key, provider key/startup/model/profile/price revision, fixed provider amount and fee, expiry, and failure/cancellation policies. Quotes last two minutes and do not reserve money. Repeating a request ID with changed quote input is rejected; an expired quote requires a new request ID.

Purchase checks live registry evidence, current price/model/profile, private descriptor, owner authority and available credits. It reserves before signing access. The prototype cloud fee is explicitly zero; tests exercise nonzero fees. `totalAtomic = providerAtomic + feeAtomic`, and measured tokens do not alter the accepted total.

Purchase retries return the **same stored execution grant and executeBefore**, never renewed execution authority. Execution admission expires within two minutes (also bounded by the connection descriptor). Grants permit request retrieval/cancellation for 24 hours. Get-request can mint a fresh 120-second action-only grant with the same request/grant identity, original startup and execution deadline, and only `get_request`/`cancel_request`; it never creates another hold or renews run permission. The private descriptor may rotate after restart while the old durable request remains bound to its original startup/provider key. Never expose ticket/grant/proof data in agent-visible tool output or logs.

## Balance and blockchain funding API

All routes require the same signed cloud proof and enrolled buyer identity:

- `POST /balance`: `{}` → owner account asset, balance, holds, available funds and remaining spending authority.
- `POST /funding/solana-devnet/intents`: `{intentId,amountAtomic}` → buyer-bound, expiring deposit terms and memo; idempotent for unchanged terms.
- `POST /funding/solana-devnet/confirm`: `{intentId,signature}` → server-verified finalized deposit and idempotent credit.

The verifier checks the full devnet genesis hash, transaction success/finality, canonical USDC mint/program/decimals, exact transfer/net recipient increase, treasury identity and memo. A public signature cannot credit multiple intents. RPC validation precedes financial row locks. The operator TEST_CREDIT fund command cannot mint devnet-USDC balances. See [payments](payments.md) for the exact deposit format and limits.

## Provider API

- `POST /provider/descriptor`: `{startupId,ticket,providerKeyId,providerPublicKeyPem,expiresAt}` → `{uploaded:true,providerId,startupId}`. The provider's startup must already exist in the registry; it may still be testing for peer-probe bootstrap. Tickets are encrypted at rest with AES-256-GCM and expire within one hour.
- `POST /provider/requests/{requestId}/authorize`: `{reservationId,grantId,operation:"run_inference",payloadDigest}` → `{authorized:true,requestId,reservationId}`. This transaction checks an active matching reservation and atomically marks execution authorized before the host calls its daemon.
- `POST /provider/requests/{requestId}/terminal`: `{event:signedTerminalEvent}` → `{requestId,status,receipt}`. The outer cloud proof and inner `DOMAIN.terminal` signature are both required.

A provider-signed completed event must match grant, reservation, request, original startup and provider key, include a durable result digest, and have prior execution admission. Failed/cancelled events may release a reservation before admission. Terminal events are metadata-only, with optional diagnostic usage. A duplicate unchanged event ID returns the existing outcome; reusing an event ID with different contents or contradicting an existing terminal outcome is rejected.

## Transactions and ledger

Buyer account locks serialize reservations across all replicas; session and UTC-day buckets count both held and settled amounts. Purchase atomically enforces available balance and all owner caps. Provider mutations lock the buyer account before changing request state. Enrollment keys are rechecked under row locks. A single request-row decision resolves completion versus cancellation.

For a nonzero paid request, successful durable completion releases the hold and posts one balanced ledger group: buyer debit = provider earnings + platform fee. Failed/cancelled work releases the hold without a debit. `unknown` stays pending and retains the hold. Buyer disconnect does not imply a refund or replay permission.

Accounts have immutable currency; quotes, grants, reservations, receipts and ledger entries retain that asset. USDC uses six decimal places; TEST_CREDIT units are separate. Free completion has zero debit/earnings/fee and no settlement entries. The PostgreSQL ledger checks that every group contains unique accounts, bounded integer-string amounts, a matching asset, and sums to zero. Ledger rows and operator audit rows reject UPDATE/DELETE. Refunds append compensating entries and credit the buyer balance; they never rewrite the original transaction. Refunded charges remain in gross daily/session spent usage, preventing refund/retry loops from expanding owner authority.

Pending requests have a ten-minute reconciliation deadline. The operator may explicitly release unresolved work after that deadline with a recorded evidence reason, or refund a settled result that could not be delivered. Reconciliation is audited; no background job silently assumes success or reruns inference. Accounts, sessions, policies, receipts, ledger entries, terminal events and descriptor encryption are persisted in PostgreSQL with RLS enabled and no browser table policies.

## Setup and operation

Dedicated project: `panas` (`7db5f8f4-c378-4ba5-a48f-f435bc4c034b`). Accounting uses its existing `registry` PostgreSQL database. Apply the full tracked migration set, including 047–051 for free access and devnet funding, through [platform migrations](platform/operations.md#migrations-and-existing-data). Files may contain multiple statements; the platform runner splits them safely inside its advisory-locked transaction and tracks checksums. Do not edit applied SQL or replay legacy migration scripts as the current deployment path. Preserve the existing registry/health/frontend configuration.

A private environment file (mode0600 outside Git) contains:

- `PANAS_REGISTRY_DATABASE_URL`: server database connection, TLS verification enabled.
- `PANAS_PLATFORM_PRIVATE_KEY_BASE64`: base64 of Ed25519 PKCS8 PEM; pin its public key in host/buyer owner configuration.
- `PANAS_DESCRIPTOR_KEY_BASE64`: base64 of a random32-byte AES key; keep stable across deploys or old encrypted descriptors become unavailable.

```sh
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts enroll-buyer /private/buyer-policy.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts open-session /private/session.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts fund /private/fund.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts resolve /private/reconciliation.json
```

Inputs:

- Enrollment: `{buyerId,publicKeyPem,maxRequestAtomic,maxSessionAtomic,maxDailyAtomic,policyVersion,currency?}`. Omit currency for TEST_CREDIT or explicitly use `SOLANA_DEVNET_USDC` for a new devnet buyer; an existing account asset cannot be changed.
- Session: `{buyerId,sessionId,capAtomic,expiresAt}`.
- Funding: `{buyerId,amountAtomic,idempotencyKey}` (positive test credits, idempotent).
- Reconciliation: `{requestId,action:"release"|"refund",reason}`; a reason of at least ten characters is required.

```sh
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/serve.ts
# local loopback-only API defaults to http://127.0.0.1:4444
# Normal cloud releases use the clean-checkout platform flow:
pnpm platform:deploy
```

For the devnet rail, the accounting runtime additionally requires `PANAS_SOLANA_DEVNET_RPC_URL`, `PANAS_SOLANA_DEVNET_TREASURY_OWNER` and `PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT`. Only public treasury information is configured; the verifier has no treasury signing key. The legacy local `serve.ts` utility constructs the test-credit service without the Solana verifier; use the current cloud bundle/deployment for funding-route validation.

The cloud endpoint is `https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run/`. It uses HTTP mode with application authentication, not public unauthenticated mutations. Only accounting receives the platform signing key and descriptor key; neither is scoped to the frontend or registry. Generated dependency-bundled code/manifests/deployment lockfiles are ignored by Git; the platform flow bundles and applies explicit variable scopes. Avoid old standalone variable/migration upload commands that bypass those release checks.

## Evidence and limits

Deterministic repository checks run without cloud credentials. Real concurrency/ledger tests are opt-in via `PANAS_ACCOUNTING_TEST_DATABASE_URL` and deliberately leave append-only audit records. Use an isolated database branch, not a customer database; deleting ledger/audit rows is prohibited by design. The development test branch expires automatically after two hours. Tests use synthetic provider evidence and do not claim actual model execution.

```sh
# Supply the private TEST database variable through the environment, not shell history.
pnpm exec vitest run packages/accounting/src/accounting.test.ts
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/cloud-smoke.ts
```

Cloud smoke enrolls a temporary buyer without minting credits, verifies missing-proof rejection, signed buyer authentication and provider availability guards, checks rejection of unauthorized access without making deposits, then removes its nonfinancial fixture rows. Full provider execution, durable outbox delivery and buyer private transport integration are validated with issues#6/#7; accounting tests alone do not prove that hardware ran inference or delivered a result.

## Historical TEST_CREDIT prototype verification

The observations below used the earlier native provider build. They establish that build’s transaction behavior, not current Docker peer or live Solana-transfer acceptance. Current [free/devnet validation](validation/free-and-devnet.md) and [Docker validation](validation/docker-sandbox.md) record their own boundaries.

Nine real PostgreSQL integration tests passed against the isolated accounting test branch, including independently constrained balance/request/session/day limits, competing purchases, immutable execution-grant retries, terminal CAS races, unknown-outcome holds, compensating refunds, post-lock proof expiry, and owner revocation. A focused rerun also verified that previously authorized provider completion settles after buyer revocation, receipt splits reconcile exactly, and SQL rejects unbalanced/malformed ledger groups.

The deployed accounting HTTP service passed missing-proof rejection and signed buyer availability/authentication smoke without minting credits. An official buyer MCP client then completed actual inference through the Mac provider and MCPWire against the deployed service: a fixed three-atomic-unit TEST_CREDIT receipt reconciled, duplicate run was rejected, and retrieval over a fresh peer preserved the same charge. This is prototype test-credit evidence, not a real-money or independent hardware-attestation claim.
