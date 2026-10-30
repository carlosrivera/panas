# PRD: Agent-discovered device resources over MCPWire

Status: Prototype implementation contract · updated October 29, 2026

This document describes the current Docker and Solana devnet design. Recorded implementation and hardware evidence are linked separately in [architecture](architecture.md) and [integration evidence](integration/README.md); acceptance requirements are not assertions that every physical drill has passed.

## 1. Goal and prototype decisions

Let buyer agents discover available providers, purchase a bounded inference request at a fixed price, and execute it on a provider’s Mac through MCPWire. Providers control availability and workload limits and accrue ledger earnings for successful paid requests; automated wallet payouts are not implemented.

The prototype proves the complete transaction, rather than model quality or marketplace breadth: **discover → quote → authorize → connect → infer → receipt**.

| Area                    | Prototype decision                                                            |
| ----------------------- | ----------------------------------------------------------------------------- |
| Provider device         | macOS on Apple Silicon                                                        |
| Inference               | CPU Ollama in a network-disabled Linux ARM64 Docker worker                    |
| Initial model           | `qwen2.5:0.5b`, pinned to a tested artifact digest                            |
| Pricing                 | Provider-selected free access or a fixed price per successful bounded request |
| Capability verification | Run at every provider-agent launch before becoming discoverable               |
| Main buyer interface    | MCP discovery and purchase tools for buyer agents                             |
| Public website          | Informational view of providers and platform behavior                         |
| Cloud deployment        | Volcano.dev for the control plane, discovery interface, and website           |
| Payments                | Free access or prepaid Solana devnet USDC; TEST_CREDIT regression rail        |
| Token counts            | Diagnostics and limit enforcement; no per-token billing in prototype          |

Macs were selected because they are the available team hardware. The current provider launcher requires Apple Silicon macOS and Docker; gateway/worker execution is Linux ARM64. Other Docker hosts require additional validation. The buyer requires Node.js and a compatible MCP client, not a Mac or local model; macOS/Linux process supervision is supported and Windows supervision remains outside the prototype matrix.

## 2. Existing foundation

Target repository: [carlosrivera/mcpwire](https://github.com/carlosrivera/mcpwire).

Its documented foundation includes encrypted peer connections, local MCP server sharing, tool allow/deny lists, session TTLs, and a session-wide call budget. Tickets are reusable while their host session remains active, and tool filtering does not sandbox the process or validate arguments. These are README-level findings, not a source-code security audit.

Extend this transport with provider registration, capability reports, structured discovery, quotes, buyer-bound entitlements, local workload admission, fixed-charge accounting, and receipts. Keep raw connectivity tickets out of public listings.

## 3. Users and scope

**Provider:** launch a local agent, pass capability checks, publish an approved inference service, set availability and a fixed request price, and view completed requests and earnings.

**Buyer agent:** find a suitable live provider, inspect machine-readable terms, obtain authorization within its owner’s spending policy, run inference, and retrieve a receipt without navigating a website.

**Operator:** approve prototype devices, monitor availability and failures, reconcile charges, and resolve disputes.

Include one model, text inputs and outputs, fixed-price calls, bounded workloads, startup tests, live discovery, reservations, local enforcement, cancellation, and receipts.

Exclude arbitrary code execution, buyer-supplied containers/models, training, multimodal workloads, dynamic token pricing, GPU rental by the hour, confidential-compute claims, public unrestricted provider onboarding, and automatic tool execution by the small inference model. A buyer agent invokes an inference capability; the small model itself need not be an agent.

## 4. Provider launch and capability tests

Every provider-agent launch enters `testing`; no launch may reuse an old passing report as proof of present readiness. A model/runtime change or critical health failure also requires a new test.

| Check        | Required evidence or action                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Device       | Launcher checks the Mac/Docker host; gateway checks Linux ARM64 confinement, memory/disk, and worker profile |
| Runtime      | Verify approved Ollama version, dedicated local endpoint, and configured model digest                        |
| Model load   | Load the small model successfully; record cold-load duration and memory pressure                             |
| Inference    | Run a short bounded smoke prompt; require a nonempty response and valid completion metadata                  |
| Benchmark    | Record warm latency, total generation duration, and observed output throughput using a versioned fixture     |
| Limits       | Verify output cap, timeout/cancellation behavior, and one-request concurrency enforcement                    |
| Connectivity | Confirm outbound registration, entitlement verification, and a separate-peer MCPWire test call               |
| Exposure     | Require offline worker, private Unix-socket IPC, internal loopback runtime, and no published host ports      |

A local self-test is insufficient proof that another peer can connect. Use a test peer where available; otherwise mark connectivity `unverified` and keep the provider out of ready-only discovery until a separate-peer probe passes.

Publish a signed, versioned capability report containing device class, model/runtime revisions, tested request limits, benchmark results, test time, startup ID, and pass/fail reasons. Reports are provider assertions, not hardware attestation. Do not upload serial numbers, private paths, prompts, or connection tickets.

Default behavior: failed tests keep the provider unavailable with actionable local diagnostics. Model downloads are an explicit setup action; a missing model should not silently trigger a large download during every launch.

Proposed liveness defaults: heartbeat every 15 seconds and expire readiness after 45 seconds without a heartbeat. Pause admission immediately on sleep, runtime failure, or critical memory pressure when detectable; missed heartbeats handle events the agent cannot report. Repeat the full suite after wake before advertising readiness again.

Provider states: `offline → testing → ready → busy/draining/paused`, with failures entering `unhealthy`. Only a fresh passing report plus an unexpired heartbeat makes a provider eligible for ready-only discovery.

## 5. Buyer-agent discovery and execution

Expose a stable local buyer MCP facade backed by signed Volcano APIs and MCPWire peer handoff. These are implemented Panas tools, distinct from MCPWire CLI commands. The remote registry MCP supplies discovery, not purchase/funding.

| Tool                 | Purpose                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `discover_providers` | Filter by capability, model, input/output limits, maximum fixed price, readiness, and observed latency       |
| `get_provider`       | Return capability report, model identity, price version, limits, report age, and availability                |
| `quote_inference`    | Return a short-lived fixed quote for a provider and bounded request envelope                                 |
| `purchase_access`    | Atomically reserve the quoted amount and issue a buyer-bound entitlement plus private connection information |
| `get_request`        | Retrieve request state, result availability, and receipt after a retry or reconnect                          |
| `cancel_request`     | Stop queued/running work and finalize its cancellation state                                                 |

The buyer facade also exposes `run_inference`, `get_balance`, `create_funding_intent`, and `confirm_funding`. After purchase it privately obtains connection material from accounting and joins MCPWire internally. The agent never receives the ticket or private grant and does not install a new MCP server per provider.

Main flow:

1. Buyer agent asks for a ready provider matching its required model, limits, price ceiling, and latency preference.
2. Discovery returns structured results with freshness and capability evidence. Default ranking favors healthy, suitable providers; paid placement is outside prototype scope.
3. Agent requests a quote, checks it against owner-configured authority, and purchases access with an idempotency key.
4. The provider rechecks readiness and entitlement at execution time. Discovery is not a capacity reservation; stale selection returns a structured failure and releases unused funds.
5. Buyer adapter joins the provider through MCPWire and submits the bounded inference request.
6. Agent receives output, finish reason, diagnostic usage, fixed charge, and receipt reference.

Cloud discovery and quote requests must not include prompt content. The local quote tool receives and encrypts the prompt, then sends only its digest and bounds to accounting. Provider descriptions are untrusted data and must not be treated as instructions by buyer agents.

## 6. Fixed pricing and accounting

Each provider publishes one versioned price for an explicitly bounded text-inference request. A quote specifies provider, model digest, price, currency, platform fee, maximum context, maximum output, deadline, expiry, and cancellation/failure rules. The accepted total cannot change during a request.

Proposed initial envelope: one active inference request per Mac, queue depth two, context ceiling 2,048 tokens including template overhead, output ceiling 128 tokens, and execution deadline 60 seconds. These are prototype defaults to validate in startup tests, not hardware guarantees. A provider failing the profile cannot advertise it; changes require a new profile and passing report.

For a successful request, `buyer charge = quoted fixed total`. Token count does not increase or decrease it. Reaching the agreed output cap is a successful bounded completion if the runtime returns a valid result and finish reason.

Atomically reserve the fixed total before authorization. Settle once after successful durable completion; release it on rejected, failed, or cancelled work. Use integer atomic units and a balanced append-only ledger. Provider earnings plus disclosed fees must reconcile to the buyer debit.

Buyer agents cannot raise their own spending authority. Apply per-request, session, and daily caps across concurrent requests. Bind each request, quote, reservation, and payment attempt to stable identifiers.

| Outcome                                    | Prototype policy                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Admission rejected or provider unavailable | No charge; release reservation                                                      |
| Valid completion durably recorded          | Charge the accepted fixed total once                                                |
| Cancel accepted before durable completion  | No charge; stop work and release reservation                                        |
| Cancel arrives after durable completion    | Return completed state and existing fixed charge                                    |
| Provider crash or deadline exceeded        | Definitive failure releases the hold; unknown crash outcome remains pending         |
| Buyer disconnect                           | Continue only within the quoted deadline; retain result for authenticated retrieval |
| Outcome uncertain                          | Pending reconciliation; never automatically execute or charge again                 |

Persist request state on the provider before acknowledging completion and reconcile with Volcano. Proposed retention: encrypted local result for 24 hours, receipt metadata for 30 days, provider prompt content only in process memory; the buyer facade stores its pending request encrypted locally. Authenticated retrieval occurs over the provider connection. If a charged result cannot be retrieved because the provider loses it, refund under the prototype policy. Race outcomes must use a single durable terminal-state decision.

Prepaid Solana devnet USDC funding is implemented alongside TEST_CREDIT regression accounting. Free access requires no funded wallet. Mainnet and automated on-chain payouts/withdrawals require additional implementation and published custody/refund terms.

## 7. Token diagnostics, limits, and Docker execution

Record input/output token counts from the approved runtime, model revision, elapsed time, and finish reason. Use conservative UTF-8 byte admission with reserved output/context headroom and the runtime’s generation limit for output; independent tokenizer verification is not implemented. Mark unavailable or provider-reported counts honestly; receipts must not imply independent verification.

Enforce request rate, maximum input bytes, context, output, queue depth, concurrency, duration, and monetary authority separately. Proposed request rate default: six accepted requests per minute per buyer/provider pair, configurable downward by the provider. Return typed limit errors with retry guidance.

Run the internet-facing gateway and inference in separate Docker containers on macOS, with no native fallback. The worker has no network and runs the small model on CPU. The current Docker path does not use native Metal acceleration. `qwen2.5:0.5b` is pinned to the approved digest; see [Docker runtime details](docker-sandbox.md).

Use a dedicated runtime instance, minimal environment, dedicated application data directory, loopback-only runtime endpoint, approved model artifacts, argument validation, process supervision, and an emergency stop. An inference prompt must never become a shell command or trigger model-generated tools. Do not expose arbitrary MCP resources, prompts, filesystem tools, or runtime management endpoints.

Require read-only roots, non-root users, dropped capabilities, no-new-privileges, bounded CPU/memory/PIDs and temporary storage. Mount only approved read-only model data and dedicated application/IPC volumes; never mount the Docker socket, host home or treasury keys. The worker must not receive gateway credentials. Keep authorization, request bounds and cancellation inside the Docker boundary. See [the Docker sandbox contract](docker-sandbox.md) and its actual validation requirements. Docker does not provide hardware attestation or confidential inference.

## 8. Paid authorization and transport

MCPWire supplies encrypted peer connectivity. A separate signed entitlement authorizes a paid operation. Possessing or copying a connectivity ticket must not authorize inference.

Bind entitlements to buyer proof-of-key possession, provider key, startup/session ID, quote, model, request ID, expiry, limits, and reserved amount. Verify at the provider before forwarding work, enforce replay protection, and keep the local runtime inaccessible through alternate remote paths.

The platform receives capability, authorization, and accounting metadata. Prompts and responses travel directly over MCPWire. Transport encryption does not prevent a provider from inspecting inference on its own Mac. A signed usage receipt attributes a claim to a provider; it does not prove execution honesty.

## 9. Volcano deployment

### External MCPWire dependency and application boundaries

Build the application in its own repository. Install a pinned, tested `@mcpwire/cli` release as an external runtime dependency and invoke its documented `share` and `join` commands. Do not depend on internal TypeScript module paths or require a fork for the prototype. The inspected [package manifest](https://github.com/carlosrivera/mcpwire/blob/main/cli/package.json) exposes a CLI binary; it does not declare a public library API.

Implement four application components:

1. **Provider daemon on the Mac:** owns startup tests, device registration, heartbeats, a single inference worker, shared admission limits, durable request state, and reconciliation. The controller and MCPWire run in the gateway container; the separate offline worker supervises Ollama through private IPC.
2. **Provider MCP server:** a thin stdio server launched by MCPWire. Exposes `get_capabilities`, `run_inference`, `get_request`, and `cancel_request`; verifies paid application requests and delegates to the local daemon over a restricted local IPC channel.
3. **Buyer MCP server/adapter:** a stable local MCP interface that calls Volcano for discovery and purchase, launches `mcpwire join` as an MCP client subprocess when needed, and forwards authorized execution calls. This avoids requiring agent clients to install a new MCP server for each provider.
4. **Volcano control plane:** owns discovery, quotes, reservations, entitlement signatures, ledger settlement, and the public informational frontend.

The [current share implementation](https://github.com/carlosrivera/mcpwire/blob/main/cli/src/share.ts) starts a child MCP process per peer and kills that child on disconnect. Consequently, these child servers must be disposable adapters: model execution, global concurrency, and durable state belong to the daemon. Multiple peers must not create independent inference workers or independent device limits. Also, application-level buyer authentication must be explicit; this launch path does not pass the transport peer identity into the child server.

Use platform-signed grants plus buyer signatures over the request identifier, operation, payload digest, and expiry. Bind responses to the expected provider through application-level provider signatures. Never infer paid buyer identity or expected provider identity merely from possession of a ticket. Host arguments use the signed `{proof,grant,payload}` envelope in [the authorization protocol](authorization-protocol.md). Because upstream argument previews can contain sensitive data, managed sessions discard raw output and disable recording; no reusable private keys enter tool arguments.

The [join implementation](https://github.com/carlosrivera/mcpwire/blob/main/cli/src/join.ts) bridges stdio JSON-RPC through the peer connection. The buyer adapter can act as an MCP client to that subprocess while exposing its own stable tool interface to the buyer agent.

The implemented transport adapter handles the following integration requirements (see [transport](transport.md) for current behavior and [evidence](integration/README.md) for observed runs): reliably capture the private ticket from a supervised noninteractive share process; validate lifecycle and restart handling; implement application identity proofs; and confirm cancellation/retrieval across peer disconnects. If structured readiness/ticket output is missing, isolate any output parsing in the transport adapter and pin/test its format. A small upstream machine-readable output feature may be preferable later, but core marketplace behavior must stay in this application.

Deploy the control plane and public informational frontend on [Volcano.dev](https://volcano.dev/). Volcano documents functions, frontends, databases, and supporting platform services in its [documentation](https://docs.volcano.dev/).

Service mapping:

- Functions/API: provider registration, heartbeat ingestion, discovery, quotes, entitlements, request reconciliation, and signed Solana funding-intent/confirmation routes.
- Remote registry MCP: discovery tools; the local buyer facade calls the signed accounting API for purchase, balance and funding.
- Postgres: provider reports, listings, price versions, reservations, request states, ledger entries, and receipts.
- Maintenance: GitHub invokes private operations to mark overdue requests pending. Read-time expiry governs readiness; audited operator decisions govern unresolved outcomes. Maintenance does not release funds or execute payouts.
- Frontend: explanatory pages and a public read-only provider status view.

Provider inference and MCPWire host processes stay in the worker/gateway Docker containers on the provider Mac. The Volcano control plane does not run the local model or terminate the peer inference connection. A Volcano cloud sandbox would not isolate a process running on a provider’s Mac.

Deployment verification checks authenticated registry MCP, HTTP authorization boundaries, operational release identity, financial invariants and frontend assets. GitHub invokes the private maintenance function because native Volcano scheduling is unavailable on the configured plan. A deployed control-plane release does not prove current Docker peer execution or physical recovery; those need separate integration evidence.

When the control plane is unavailable, reject new purchases. Already authorized work may finish within its existing reservation and deadline, persist its receipt locally, and reconcile when service returns.

## 10. Public informational listing

The public site explains the service, supported prototype model, limits, pricing policy, privacy assumptions, and how to connect a buyer agent. Provider cards may show pseudonymous identity, supported model, fixed price, readiness, benchmark timestamp, and aggregate reliability.

Exclude tickets, peer connection secrets, wallet secrets, precise location, device serials, and buyer activity. Freshness labels must match discovery’s readiness rules. The website reflects the registry; it is not a required step in the buyer transaction and does not replace structured discovery.

## 11. Solana devnet prepaid payments

Providers may offer free access (including zero platform fee) or fixed-price paid access. Free requests retain identity, signed execution grants, resource/rate caps and zero-charge receipts without requiring wallet funding. The first blockchain payment rail is prepaid Solana devnet test USDC; TEST_CREDIT remains an internal regression rail, never a token conversion. See [payment implementation and rollout](payments.md). Mainnet and automated on-chain payouts remain disabled.

The implemented rail uses buyer-bound funding intents and finalized SPL Token transfer verification, not x402. Accounting verifies cluster, canonical mint, program/decimals, treasury, amount and memo before crediting once. Wallet private keys never enter MCP tools or the verifier.

Accounts are bound to `SOLANA_DEVNET_USDC` or `TEST_CREDIT`; assets are not mixed or converted. USDC uses integer atomic units with six decimals. Successful inference settles against the prepaid balance. Refund ledger entries restore that balance, not an on-chain wallet transfer. Mainnet, automated provider payouts and withdrawals are not implemented.

Verify asset, network, recipient, amount, expiry, and payment identity; deduplicate callbacks; never spend unconfirmed deposits. Keep prompts, outputs, tickets, and entitlements off-chain. Display all fees. Do not claim that payment settlement proves execution. Resolve funding, custody, payout, and refund operation before accepting real money.

## 12. Acceptance criteria and milestones

Prototype success requires:

1. A fresh Mac launch runs capability tests; a failed test prevents ready-only discovery.
2. A passing provider appears to the buyer agent without any website interaction.
3. An agent discovers, quotes, authorizes, joins, and invokes inference through the supported adapter with no manual server configuration per purchase.
4. Accepted price and request bounds remain fixed regardless of measured tokens.
5. Copied tickets, expired grants, invalid buyer keys, duplicate purchases, and replayed requests do not execute unauthorized work or duplicate charges.
6. Concurrent purchases cannot overspend a balance or exceed local concurrency and queue limits.
7. Cancellation, timeout, provider restart, disconnect, and unavailable control plane produce the specified terminal state and accounting outcome.
8. Sleep/offline providers expire from ready-only results within the heartbeat window; waking devices retest before rejoining.
9. The runtime stays inside the offline worker with private loopback and Unix-socket IPC, no host-published ports and no host filesystem or command-execution capability exposed to buyers.
10. Discovery, accounting, and the informational site deploy on Volcano while inference runs on the provider’s Mac.

Milestones:

- **A — Local proof:** isolated Docker CPU runtime, small pinned model, launch tests, bounded inference MCP tool, and MCPWire peer call.
- **B — Agent discovery:** Volcano registry, heartbeats, remote discovery tools, and automatic buyer-adapter handoff.
- **C — Fixed-price transaction:** asset-bound reservations, verified devnet funding, signed entitlements, durable outcomes, receipts, and cancellation/reconnect tests.
- **D — Demo deployment:** informational site, two provider Macs, an agent selecting between them, and end-to-end failure demonstrations.
- **E — Production payment pilot:** mainnet funding, withdrawal/payout implementation, validated custody and published financial policies; not part of the current devnet prototype.

Track time from launch to discoverability, agent discovery-to-success rate, stale-provider selections, capability-test failures, inference latency, duplicate-charge count, and receipt reconciliation age. The core demo is an agent discovering two Macs, choosing an eligible provider, completing one fixed-price inference, and retrieving a matching receipt.
