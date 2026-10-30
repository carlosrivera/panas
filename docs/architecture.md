# Panas AI architecture

Panas is peer-to-peer inference infrastructure for AI agents: **discover → quote → authorize → connect → infer → receipt**. Participating computers supply inference capacity; a dedicated inference data center is not required. Cloudflare Workers hosts the centralized discovery, authorization, and accounting control plane. Prompts and outputs travel over the encrypted buyer-to-provider MCPWire connection.

## Platform and deployment boundaries

The current provider launcher targets Apple Silicon macOS 14+ because that is the team's available hardware. Serving runs in two Linux ARM64 Docker containers, not native host Ollama. The small model runs on CPU; the current path does not use Metal acceleration and has no native fallback. Other Docker hosts/architectures require additional launcher/runtime validation before being advertised as supported.

The buyer needs Node.js 24, the buyer MCP facade, and an MCP-compatible agent client. Free demos automatically generate a private local identity and enroll a zero-authority session; paid buyers retain operator-managed owner configuration. It needs neither macOS, Docker, nor a local inference model. Transport process supervision supports macOS and Linux; Windows process-tree supervision is outside the current support matrix.

```text
Buyer agent ── MCP ── Buyer facade ── signed HTTPS ── Cloudflare Workers
                           │                         registry / accounting
                           │ encrypted MCPWire                │
                           ▼                                  │ signed grants,
                    Provider gateway ◄────────────────────────┘ authorization,
                           │                                    terminal events
                           │ authenticated Unix-socket IPC
                           ▼
                    Offline Ollama worker
                    pinned model · CPU inference

Solana devnet ── verified finalized USDC deposit ──► prepaid buyer balance
```

## Component ownership

| Component                                          | Owns                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac CLI launcher                                   | Model staging, matching image verification, container profiles, stdin-delivered gateway configuration, launcher heartbeat lease, owned-container cleanup                    |
| Gateway container / persistent provider controller | Startup tests, registry publication, MCPWire share, disposable peer adapters, signed authorization, one device-wide queue, encrypted durable request state, terminal outbox |
| Offline worker container                           | Dedicated pinned Ollama process, model info, bounded generation and cancellation; receives no application or treasury private keys                                          |
| Buyer MCP facade                                   | Stable agent tools, cloud clients, owner budget checks, private connection handoff, signed operations, verified results and receipt retrieval                               |
| Cloudflare registry                                | Enrolled provider public keys, capability reports, fresh readiness, public projection and authenticated discovery                                                           |
| Cloudflare accounting                              | Quotes, owner authority, asset-bound balances, funding intents/confirmation, reservations, signed grants, ledger, receipts, reconciliation                                  |
| Operations and website                             | Private financial/release health and pending-review maintenance; public informational/provider views                                                                        |

See [Docker boundary](docker-sandbox.md), [buyer facade](../apps/buyer-mcp/README.md), and [provider controller](../apps/provider-mcp/README.md).

## Docker isolation and runtime

Both containers run as UID 10001, with read-only roots, dropped capabilities, no-new-privileges, default seccomp, CPU/memory/PID bounds and bounded temporary storage. The gateway has network egress for peers and cloud APIs. The worker has networking disabled; its internal loopback Ollama endpoint is not published to the host or peers. The gateway publishes one UDP DHT socket, with bounded address hints delivered only in the encrypted private handoff so native buyers can reach a Docker Desktop host. Gateway-to-worker requests use authenticated Unix-socket IPC on a dedicated tmpfs volume.

Only the gateway receives the provider application key, delivered over Docker stdin into private tmpfs rather than arguments, image layers or environment metadata. The worker receives verified, read-only model manifests/blobs and IPC storage. Neither container receives the host home, Docker socket or treasury key. Durable gateway state lives in a provider-specific volume and must survive restart; its disk growth needs operator monitoring.

The launcher inspects Docker configuration and the containers verify effective privilege/filesystem/cgroup controls. Failed isolation or capability checks prevent readiness. The launcher heartbeat lease closes the gateway after owner loss/suspension. A restart creates a new startup without replaying interrupted work. Container-scoped ownership prevents confusing a PID from a previous container with a live owner in the new one.

## Readiness and agent interface

Each launch starts in `testing`, checks Linux ARM64 confinement, memory/disk, runtime/model pins, bounded cold/warm inference, cancellation and limits, then obtains a separate-process peer probe before readiness publication. A local probe proves an MCP round trip on that machine; cross-host/NAT reachability needs a real remote request. Reports are signed provider assertions, not hardware attestation.

Heartbeats default to 15 seconds with a 45-second lease. Expired readiness is rejected at read/admission time. Model/runtime change, liveness failure and recovery require fresh evidence. See [registry protocol](registry.md).

The stable buyer MCP exposes `discover_providers`, `get_provider`, `quote_inference`, `purchase_access`, `run_inference`, `get_request`, and `cancel_request`, plus `get_balance`, `create_funding_intent`, and `confirm_funding`. Provider handoff stays inside the facade; the agent does not install a new server per provider. The remote registry MCP is discovery-only; purchasing/funding use signed accounting HTTP calls through the facade.

## Transaction and durable outcomes

1. Discover a ready provider matching model, limits, currency and fixed price. Discovery reserves no capacity.
2. Store the prompt encrypted on the buyer and send only its digest and bounds for a short-lived quote.
3. Purchase idempotently. Accounting atomically reserves the accepted total under balance/request/session/day limits and returns a signed grant and private descriptor to the facade.
4. Join through MCPWire. Verify the grant, buyer operation proof, current startup, payload and limits; obtain live accounting execution authorization before generation.
5. Execute one bounded request. Defaults are one active worker, queue depth two, 2,048 context tokens, at most 128 output tokens and a 60-second execution deadline. Conservative UTF-8 admission reserves context headroom rather than claiming independent tokenizer verification.
6. Persist the result and signed terminal event durably in encrypted gateway state. The persistent outbox retries the same event until cloud acknowledgment; disposable adapter loss does not erase it.
7. Accounting commits one terminal outcome and receipt. Durable success settles the accepted fixed charge; definitive failure/cancellation releases the hold. Unknown work stays pending for reconciliation. Token counts are diagnostics, not billing units.

Cancellation after durable completion returns the completed outcome. Disconnect or a lost response never authorizes automatic reexecution. Fresh action-only grants allow authenticated original-request retrieval without renewing run permission. Results have a 24-hour retention window and request/receipt metadata a 30-day window in provider storage. See [accounting](accounting.md) and [authorization](authorization-protocol.md).

## Solana payments and ledger

Implemented payment modes are free access, prepaid `SOLANA_DEVNET_USDC`, and the internal `TEST_CREDIT` regression rail. Free requests still require enrollment, signed grants and workload limits, but no funded balance or positive monetary caps; their receipts have zero debit/earnings/fee and no settlement ledger entries.

For paid access, the owner transfers devnet USDC against a buyer-bound funding intent. The accounting verifier checks the devnet genesis hash, finalized transaction, canonical mint/program/decimals, exact amount, treasury recipient and memo. Confirmation credits the prepaid balance once; no private wallet key enters the MCP interface or verifier. Amounts use integer atomic units; USDC has six decimals. Accounts retain their asset and deposits do not raise owner spending authority.

Inference settlement and refunds use balanced append-only PostgreSQL ledger entries in that asset. A ledger refund restores prepaid balance; it is not an on-chain transfer back to a wallet. Mainnet, automated on-chain provider payouts and wallet withdrawals are not implemented. See [payment protocol and configuration](payments.md).

## Encryption, identity and trust

MCPWire supplies encrypted peer connectivity through its external pinned CLI (`share`/`join`). Panas uses the installed public binary, not private modules or a fork. Each peer gets a disposable MCP adapter; persistent state and device-wide admission remain in the gateway controller.

Ed25519 signatures over purpose-separated canonical JSON bind grants, buyer operations, provider responses, terminal events and cloud requests. Validation includes keys, operation/target, request/startup, payload digest, nonce and expiry. Possessing a transport ticket alone grants no inference authority. Managed sessions suppress upstream raw output/argument previews and disable recording. Tickets, grants and secrets are excluded from public discovery and buyer agent-visible output.

Buyer state, provider stored results and cloud private descriptors use AES-256-GCM at rest. Encryption does not hide a workload from its provider, who controls the host and local keys. Signatures attribute messages; they do not prove honest execution or independent token counts. Docker limits access but does not provide confidential computing, hardware attestation, a destination allowlist for gateway egress or immunity to runtime/kernel vulnerabilities.

## Cloud operation and evidence

Volcano hosts registry/accounting HTTP functions, registry MCP discovery, PostgreSQL and a private operations function. The Next.js website is statically exported to GitHub Pages and served at `panas.mcpwire.co` by Cloudflare. More-specific API route exclusions preserve `/registry` and `/accounting` on the existing Volcano origin; provider and buyer configuration does not change. GitHub maintenance marks overdue requests pending; it never invents terminal events, releases holds or pays out automatically. New purchases and execution authorization fail closed during cloud outages; already-authorized bounded work may finish and persist an outbox event for later delivery. See [deployment](deployment.md) and [operations](platform/operations.md).

The [integration evidence](integration/README.md) records earlier native-build cloud/peer transactions separately from [local Docker isolation/inference observations](validation/docker-sandbox.md). A complete current Docker transaction across two physical Macs, physical sleep/crash recovery and an actual deployed-service outage remain acceptance gates until observed. Implementation, fixtures, local probes and historical runs do not silently satisfy those gates.

## Cloudflare API hosting and free enrollment

Registry and accounting run in the `panas-api` Worker at the unchanged
`https://panas.mcpwire.co/registry` and `/accounting` bases. PostgreSQL remains
on Volcano with the existing data and keys. Direct per-invocation `pg` connections
preserve the proxy-required `application_name` and TLS startup options; Hyperdrive
cannot currently validate that proxy's startup requirements. API responses are not
cached. A Workers Cron Trigger performs metadata reconciliation every ten minutes.

`POST /accounting/demo/enroll` verifies a short-lived, domain-separated Ed25519
proof of possession. The public key determines the buyer UUID; callers cannot
select or overwrite another buyer. Enrollment creates zero request/session/daily
spending caps, zero credit and a renewable 24-hour session. Retries keep the same
identity and session, preserve spending state and cannot enable disabled records
or change operator-owned authority. The endpoint is size-bounded and rate-limited
per Cloudflare client IP. It does not enroll providers or fund wallets.

The response contains the platform public key and a signed 24-hour token scoped
to free-provider discovery. Registry verifies that token and forces zero-price
filters for both HTTP and MCP; paid-provider details are denied. All purchases,
provider actions and receipts keep their existing signed authorization. The CLI
stores its private key locally, pins the platform key and renews its demo session
when launching the buyer facade. Separate client stores isolate demos from paid
owner configuration. See [Cloudflare deployment](platform/cloudflare.md).
