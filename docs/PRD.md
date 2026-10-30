# PRD: Agent-discovered device resources over MCPWire

Status: Draft v0.3 · October 28, 2026

## 1. Goal and prototype decisions

Let buyer agents discover available providers, purchase a bounded inference request at a fixed price, and execute it on a provider’s Mac through MCPWire. Providers control availability and workload limits and receive payment for successful requests.

The prototype proves the complete transaction, rather than model quality or marketplace breadth: **discover → quote → authorize → connect → infer → receipt**.

| Area                    | Prototype decision                                                            |
| ----------------------- | ----------------------------------------------------------------------------- |
| Provider device         | macOS on Apple Silicon                                                        |
| Inference               | Native Ollama with one small approved model                                   |
| Initial model           | Proposed default: `qwen2.5:0.5b`, pinned to a tested artifact digest          |
| Pricing                 | Provider-selected free access or a fixed price per successful bounded request |
| Capability verification | Run at every provider-agent launch before becoming discoverable               |
| Main buyer interface    | MCP discovery and purchase tools for buyer agents                             |
| Public website          | Informational view of providers and platform behavior                         |
| Cloud deployment        | Volcano.dev for the control plane, discovery interface, and website           |
| Payments                | Adapter-based; test credits first, optional blockchain paywall                |
| Token counts            | Diagnostics and limit enforcement; no per-token billing in prototype          |

The model and runtime are a proposed implementation default. The provider OS, fixed pricing, startup tests, Volcano deployment, and agent-led discovery are product requirements.

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

| Check        | Required evidence or action                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Device       | Detect macOS version, Apple Silicon architecture, physical memory, free disk space, and runtime prerequisites |
| Runtime      | Verify approved Ollama version, dedicated local endpoint, and configured model digest                         |
| Model load   | Load the small model successfully; record cold-load duration and memory pressure                              |
| Inference    | Run a short bounded smoke prompt; require a nonempty response and valid completion metadata                   |
| Benchmark    | Record warm latency, total generation duration, and observed output throughput using a versioned fixture      |
| Limits       | Verify output cap, timeout/cancellation behavior, and one-request concurrency enforcement                     |
| Connectivity | Confirm outbound registration, entitlement verification, and a separate-peer MCPWire test call                |
| Exposure     | Confirm runtime endpoint is bound to loopback and only the approved inference operation is exposed            |

A local self-test is insufficient proof that another peer can connect. Use a test peer where available; otherwise mark connectivity `unverified` and keep the provider out of ready-only discovery until a separate-peer probe passes.

Publish a signed, versioned capability report containing device class, model/runtime revisions, tested request limits, benchmark results, test time, startup ID, and pass/fail reasons. Reports are provider assertions, not hardware attestation. Do not upload serial numbers, private paths, prompts, or connection tickets.

Default behavior: failed tests keep the provider unavailable with actionable local diagnostics. Model downloads are an explicit setup action; a missing model should not silently trigger a large download during every launch.

Proposed liveness defaults: heartbeat every 15 seconds and expire readiness after 45 seconds without a heartbeat. Pause admission immediately on sleep, runtime failure, or critical memory pressure when detectable; missed heartbeats handle events the agent cannot report. Repeat the full suite after wake before advertising readiness again.

Provider states: `offline → testing → ready → busy/draining/paused`, with failures entering `unhealthy`. Only a fresh passing report plus an unexpired heartbeat makes a provider eligible for ready-only discovery.

## 5. Buyer-agent discovery and execution

Expose a platform MCP server backed by Volcano services. The tool names below are proposed contracts, not existing MCPWire APIs.

| Tool                 | Purpose                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `discover_providers` | Filter by capability, model, input/output limits, maximum fixed price, readiness, and observed latency       |
| `get_provider`       | Return capability report, model identity, price version, limits, report age, and availability                |
| `quote_inference`    | Return a short-lived fixed quote for a provider and bounded request envelope                                 |
| `purchase_access`    | Atomically reserve the quoted amount and issue a buyer-bound entitlement plus private connection information |
| `get_request`        | Retrieve request state, result availability, and receipt after a retry or reconnect                          |
| `cancel_request`     | Stop queued/running work and finalize its cancellation state                                                 |

After purchase, a local buyer adapter joins MCPWire and exposes the provider’s approved `run_inference` tool to the agent. The cloud discovery server returns a connection descriptor; it does not assume every MCP client can dynamically install another server. The prototype buyer adapter must implement this handoff automatically or expose one stable local facade that performs it internally.

Main flow:

1. Buyer agent asks for a ready provider matching its required model, limits, price ceiling, and latency preference.
2. Discovery returns structured results with freshness and capability evidence. Default ranking favors healthy, suitable providers; paid placement is outside prototype scope.
3. Agent requests a quote, checks it against owner-configured authority, and purchases access with an idempotency key.
4. The provider rechecks readiness and entitlement at execution time. Discovery is not a capacity reservation; stale selection returns a structured failure and releases unused funds.
5. Buyer adapter joins the provider through MCPWire and submits the bounded inference request.
6. Agent receives output, finish reason, diagnostic usage, fixed charge, and receipt reference.

Discovery and quote requests must not include prompt content. Provider descriptions are untrusted data and must not be treated as instructions by buyer agents.

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
| Provider crash or deadline exceeded        | No charge; release/refund                                                           |
| Buyer disconnect                           | Continue only within the quoted deadline; retain result for authenticated retrieval |
| Outcome uncertain                          | Pending reconciliation; never automatically execute or charge again                 |

Persist request state on the provider before acknowledging completion and reconcile with Volcano. Proposed retention: encrypted local result for 24 hours, receipt metadata for 30 days, prompt content only in process memory. Authenticated retrieval occurs over the provider connection. If a charged result cannot be retrieved because the provider loses it, refund under the prototype policy. Race outcomes must use a single durable terminal-state decision.

Start with test credits to prove accounting. Real paid launch additionally requires a configured funding/payout adapter and published fee/refund terms.

## 7. Token diagnostics, limits, and macOS execution

Record input/output token counts from the approved runtime, model revision, elapsed time, and finish reason. Use tokenizer-compatible validation for context admission and the runtime’s generation limit for output. Mark unavailable or provider-reported counts honestly; receipts must not imply independent verification.

Enforce request rate, maximum input bytes, context, output, queue depth, concurrency, duration, and monetary authority separately. Proposed request rate default: six accepted requests per minute per buyer/provider pair, configurable downward by the provider. Return typed limit errors with retry guidance.

Run inference natively on macOS. [Ollama documents](https://docs.ollama.com/macos) Apple M-series CPU/GPU support; [qwen2.5:0.5b](https://ollama.com/library/qwen2.5:0.5b) is a small candidate for the proof of concept.

Use a dedicated runtime instance, minimal environment, dedicated application data directory, loopback-only runtime endpoint, approved model artifacts, argument validation, process supervision, and an emergency stop. An inference prompt must never become a shell command or trigger model-generated tools. Do not expose arbitrary MCP resources, prompts, filesystem tools, or runtime management endpoints.

A dedicated native process is not a complete hostile-code sandbox. The prototype runs only a trusted inference runtime, accepts data rather than executable workloads, and relies on bounded generation, concurrency, deadlines, health monitoring, and provider controls. Hard per-request unified-memory or GPU partitions are not promised. Docker is not the prototype isolation or resource-enforcement dependency; stronger OS isolation is a separate validation task before broader workloads.

## 8. Paid authorization and transport

MCPWire supplies encrypted peer connectivity. A separate signed entitlement authorizes a paid operation. Possessing or copying a connectivity ticket must not authorize inference.

Bind entitlements to buyer proof-of-key possession, provider key, startup/session ID, quote, model, request ID, expiry, limits, and reserved amount. Verify at the provider before forwarding work, enforce replay protection, and keep the local runtime inaccessible through alternate remote paths.

The platform receives capability, authorization, and accounting metadata. Prompts and responses travel directly over MCPWire. Transport encryption does not prevent a provider from inspecting inference on its own Mac. A signed usage receipt attributes a claim to a provider; it does not prove execution honesty.

## 9. Volcano deployment

### External MCPWire dependency and application boundaries

Build the application in its own repository. Install a pinned, tested `@mcpwire/cli` release as an external runtime dependency and invoke its documented `share` and `join` commands. Do not depend on internal TypeScript module paths or require a fork for the prototype. The inspected [package manifest](https://github.com/carlosrivera/mcpwire/blob/main/cli/package.json) exposes a CLI binary; it does not declare a public library API.

Implement four application components:

1. **Provider daemon on the Mac:** owns startup tests, device registration, heartbeats, a single inference worker, shared admission limits, durable request state, and reconciliation. It supervises MCPWire and the native runtime.
2. **Provider MCP server:** a thin stdio server launched by MCPWire. Exposes `get_capabilities`, `run_inference`, `get_request`, and `cancel_request`; verifies paid application requests and delegates to the local daemon over a restricted local IPC channel.
3. **Buyer MCP server/adapter:** a stable local MCP interface that calls Volcano for discovery and purchase, launches `mcpwire join` as an MCP client subprocess when needed, and forwards authorized execution calls. This avoids requiring agent clients to install a new MCP server for each provider.
4. **Volcano control plane:** owns discovery, quotes, reservations, entitlement signatures, ledger settlement, and the public informational frontend.

The [current share implementation](https://github.com/carlosrivera/mcpwire/blob/main/cli/src/share.ts) starts a child MCP process per peer and kills that child on disconnect. Consequently, these child servers must be disposable adapters: model execution, global concurrency, and durable state belong to the daemon. Multiple peers must not create independent inference workers or independent device limits. Also, application-level buyer authentication must be explicit; this launch path does not pass the transport peer identity into the child server.

Use platform-signed grants plus buyer signatures over the request identifier, operation, payload digest, and expiry. Bind responses to the expected provider through application-level provider signatures. Never infer paid buyer identity or expected provider identity merely from possession of a ticket. Avoid raw authorization material in tool arguments because the transport logs argument previews; use opaque grant references and a deliberately designed authenticated session/request envelope, and verify actual log behavior in integration tests.

The [join implementation](https://github.com/carlosrivera/mcpwire/blob/main/cli/src/join.ts) bridges stdio JSON-RPC through the peer connection. The buyer adapter can act as an MCP client to that subprocess while exposing its own stable tool interface to the buyer agent.

Integration spike requirements: reliably capture the private ticket from a supervised noninteractive share process; validate lifecycle and restart handling; implement application identity proofs; and confirm cancellation/retrieval across peer disconnects. If structured readiness/ticket output is missing, isolate any output parsing in the transport adapter and pin/test its format. A small upstream machine-readable output feature may be preferable later, but core marketplace behavior must stay in this application.

Deploy the control plane and public informational frontend on [Volcano.dev](https://volcano.dev/). Volcano documents functions, frontends, databases, and supporting platform services in its [documentation](https://docs.volcano.dev/).

Proposed service mapping:

- Functions/API: provider registration, heartbeat ingestion, discovery, quotes, entitlements, request reconciliation, and payment webhooks.
- Remote MCP interface: discovery and purchase tools, backed by the same service logic and authorization as the API.
- Postgres: provider reports, listings, price versions, reservations, request states, ledger entries, and receipts.
- Background execution: stale-provider cleanup, uncertain-request reconciliation, and eventual payouts, using validated Volcano primitives.
- Frontend: explanatory pages and a public read-only provider status view.

Provider inference and MCPWire host processes stay on the Mac. The Volcano control plane does not run the local model or terminate the peer inference connection. A Volcano cloud sandbox would not isolate a process running on a provider’s Mac.

Validate remote MCP transport/authentication support, heartbeat expiry, transactional database behavior, secret management, background scheduling, and deployment limits in the first deployment spike. Select implementations from actual supported Volcano APIs; these are architecture requirements, not claims of prevalidated integration.

When the control plane is unavailable, reject new purchases. Already authorized work may finish within its existing reservation and deadline, persist its receipt locally, and reconcile when service returns.

## 10. Public informational listing

The public site explains the service, supported prototype model, limits, pricing policy, privacy assumptions, and how to connect a buyer agent. Provider cards may show pseudonymous identity, supported model, fixed price, readiness, benchmark timestamp, and aggregate reliability.

Exclude tickets, peer connection secrets, wallet secrets, precise location, device serials, and buyer activity. Freshness labels must match discovery’s readiness rules. The website reflects the registry; it is not a required step in the buyer transaction and does not replace structured discovery.

## 11. Optional blockchain paywall

Providers may offer free access (including zero platform fee) or fixed-price paid access. Free requests retain identity, signed execution grants, resource/rate caps and zero-charge receipts without requiring wallet funding. The first blockchain payment rail is prepaid Solana devnet test USDC; TEST_CREDIT remains an internal regression rail, never a token conversion. See [payment implementation and rollout](payments.md). Mainnet and automated on-chain payouts remain disabled.

Keep blockchain behind the payment adapter. Fixed pricing makes [x402’s exact scheme](https://github.com/x402-foundation/x402/blob/main/docs/schemes/exact.mdx) a plausible fit; its [MCP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md) requires compatibility testing with the buyer adapter and MCPWire handoff.

Prototype accounting uses test credits. If real blockchain payments are enabled, choose one stablecoin and network. Prepaid funding plus the reservation ledger is the simplest initial refund-compatible path. Direct exact payment per request is an alternative experiment and requires explicit handling of payment success followed by inference failure.

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
9. The runtime stays loopback-only and exposes no host filesystem or command-execution capability to buyers.
10. Discovery, accounting, and the informational site deploy on Volcano while inference runs on the provider’s Mac.

Milestones:

- **A — Local proof:** native runtime, small pinned model, launch tests, bounded inference MCP tool, and MCPWire peer call.
- **B — Agent discovery:** Volcano registry, heartbeats, remote discovery tools, and automatic buyer-adapter handoff.
- **C — Fixed-price transaction:** test-credit reservations, signed entitlements, durable outcomes, receipts, and cancellation/reconnect tests.
- **D — Demo deployment:** informational site, two provider Macs, an agent selecting between them, and end-to-end failure demonstrations.
- **E — Optional paid pilot:** real funding/payout adapter, blockchain experiment if selected, and published financial policies.

Track time from launch to discoverability, agent discovery-to-success rate, stale-provider selections, capability-test failures, inference latency, duplicate-charge count, and receipt reconciliation age. The core demo is an agent discovering two Macs, choosing an eligible provider, completing one fixed-price inference, and retrieving a matching receipt.
