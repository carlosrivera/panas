# Fixed-price test-credit accounting

`@panas/accounting` implements the financial authorization service shared by the provider host and buyer facade. It accepts **TEST_CREDIT only**. There is no card, stablecoin, blockchain, withdrawal, or real-money funding path.

## Trust and authority

Buyers have operator-enrolled Ed25519 keys, a cached posted balance, owner request/session/daily limits, and owner-configured sessions. Buyer API calls cannot mint credits or raise any policy. The private operator CLI manages enrollment, limits, sessions, test-credit funding, and audited reconciliation; it requires a private database connection and must never be installed as a buyer agent tool.

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

## Provider API

- `POST /provider/descriptor`: `{startupId,ticket,providerKeyId,providerPublicKeyPem,expiresAt}` → `{uploaded:true,providerId,startupId}`. The provider's startup must already exist in the registry; it may still be testing for peer-probe bootstrap. Tickets are encrypted at rest with AES-256-GCM and expire within one hour.
- `POST /provider/requests/{requestId}/authorize`: `{reservationId,grantId,operation:"run_inference",payloadDigest}` → `{authorized:true,requestId,reservationId}`. This transaction checks an active matching reservation and atomically marks execution authorized before the host calls its daemon.
- `POST /provider/requests/{requestId}/terminal`: `{event:signedTerminalEvent}` → `{requestId,status,receipt}`. The outer cloud proof and inner `DOMAIN.terminal` signature are both required.

A provider-signed completed event must match grant, reservation, request, original startup and provider key, include a durable result digest, and have prior execution admission. Failed/cancelled events may release a reservation before admission. Terminal events are metadata-only, with optional diagnostic usage. A duplicate unchanged event ID returns the existing outcome; reusing an event ID with different contents or contradicting an existing terminal outcome is rejected.

## Transactions and ledger

Buyer account locks serialize reservations across all replicas; session and UTC-day buckets count both held and settled amounts. Purchase atomically enforces available balance and all owner caps. Provider mutations lock the buyer account before changing request state. Enrollment keys are rechecked under row locks. A single request-row decision resolves completion versus cancellation.

Successful durable completion releases the hold and posts one balanced ledger group: buyer debit = provider earnings + platform fee. Failed/cancelled work releases the hold without a debit. `unknown` stays pending and retains the hold. Buyer disconnect does not imply a refund or replay permission.

The PostgreSQL ledger checks that every group contains unique accounts, bounded integer-string amounts, and sums to zero. Ledger rows and operator audit rows reject UPDATE/DELETE. Refunds append compensating entries and credit the buyer balance; they never rewrite the original transaction. Refunded charges remain in gross daily/session spent usage, preventing refund/retry loops from expanding owner authority.

Pending requests have a ten-minute reconciliation deadline. The operator may explicitly release unresolved work after that deadline with a recorded evidence reason, or refund a settled result that could not be delivered. Reconciliation is audited; no background job silently assumes success or reruns inference. Accounts, sessions, policies, receipts, ledger entries, terminal events and descriptor encryption are persisted in PostgreSQL with RLS enabled and no browser table policies.

## Setup and operation

Dedicated project: `panas` (`7db5f8f4-c378-4ba5-a48f-f435bc4c034b`). Accounting uses its existing `registry` PostgreSQL database. Apply migrations 020–043 before deployment. Each migration is one idempotent SQL statement. Preserve the existing registry/health/frontend configuration.

A private environment file (mode0600 outside Git) contains:

- `PANAS_REGISTRY_DATABASE_URL`: server database connection, TLS verification enabled.
- `PANAS_PLATFORM_PRIVATE_KEY_BASE64`: base64 of Ed25519 PKCS8 PEM; pin its public key in host/buyer owner configuration.
- `PANAS_DESCRIPTOR_KEY_BASE64`: base64 of a random32-byte AES key; keep stable across deploys or old encrypted descriptors become unavailable.

```sh
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/migrate.ts
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts enroll-buyer /private/buyer-policy.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts open-session /private/session.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts fund /private/fund.json
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/operator.ts resolve /private/reconciliation.json
```

Inputs:

- Enrollment: `{buyerId,publicKeyPem,maxRequestAtomic,maxSessionAtomic,maxDailyAtomic,policyVersion}`.
- Session: `{buyerId,sessionId,capAtomic,expiresAt}`.
- Funding: `{buyerId,amountAtomic,idempotencyKey}` (positive test credits, idempotent).
- Reconciliation: `{requestId,action:"release"|"refund",reason}`; a reason of at least ten characters is required.

```sh
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/serve.ts
# local loopback-only API defaults to http://127.0.0.1:4444
pnpm --filter @panas/accounting run bundle
volcano cloud variables deploy -f /private/accounting.env
volcano cloud functions deploy -f accounting
volcano cloud config deploy
```

The cloud endpoint is `https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run/`. It uses HTTP mode with application authentication, not public unauthenticated mutations. Only accounting receives the platform signing key and descriptor key; neither is scoped to the frontend or registry. Generated dependency-bundled code/manifests/deployment lockfiles are ignored by Git; build before deploying the whole project.

## Evidence and limits

Deterministic repository checks run without cloud credentials. Real concurrency/ledger tests are opt-in via `PANAS_ACCOUNTING_TEST_DATABASE_URL` and deliberately leave append-only audit records. Use an isolated database branch, not a customer database; deleting ledger/audit rows is prohibited by design. The development test branch expires automatically after two hours. Tests use synthetic provider evidence and do not claim actual model execution.

```sh
# Supply the private TEST database variable through the environment, not shell history.
pnpm exec vitest run packages/accounting/src/accounting.test.ts
node --env-file=/private/accounting.env --import tsx packages/accounting/scripts/cloud-smoke.ts
```

Cloud smoke enrolls a temporary buyer without minting credits, verifies missing-proof rejection, signed buyer authentication and provider availability guards, proves no buyer funding route exists, then removes its nonfinancial fixture rows. Full provider execution, durable outbox delivery and buyer private transport integration are validated with issues#6/#7; accounting tests alone do not prove that hardware ran inference or delivered a result.
