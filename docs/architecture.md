# Panas AI architecture

The prototype proves **discover → quote → authorize → connect → infer → receipt**. The provider runs on an Apple Silicon Mac. Volcano hosts the control plane and informational website. Pricing is fixed per successful bounded request; token counts support diagnostics and limits.

## Component boundaries

| Component              | Owns                                                                                                                                   | Does not own                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Provider daemon        | Startup capability suite, Ollama supervisor, one inference worker, device-wide admission, durable requests, heartbeats, reconciliation | Cloud balances or buyer-agent configuration                   |
| Provider MCP adapter   | Disposable stdio tool server, argument/authentication validation, local daemon IPC                                                     | Model instances or independent per-peer device limits         |
| Buyer MCP facade       | Stable agent tools, discovery/purchase client, MCPWire join lifecycle, request signatures, result retrieval                            | Authority to increase owner budgets                           |
| Volcano control plane  | Registry, fresh readiness, quotes, reservations, entitlement signing, ledger, receipts, reconciliation                                 | Inference prompt/output routing                               |
| Informational frontend | Public status and capabilities, pricing explanation, setup instructions                                                                | Private tickets, buyer activity, required checkout navigation |
| Shared contracts       | Versioned schemas, lifecycle states, money representation, typed errors                                                                | Database or transport-specific behavior                       |
| MCPWire adapter        | Pinned CLI process integration, ticket capture, lifecycle, stdio bridge                                                                | Marketplace policy or model logic                             |

Concrete package names should follow the workspace scaffold. Keep shared contract and transport packages distinct so provider, buyer, and cloud lanes can progress independently.

## MCPWire as an external foundation

Panas launches a pinned `@mcpwire/cli` release through its supported `share` and `join` commands. Do not import internal MCPWire TypeScript paths. Wrap command construction and supervised process behavior in the transport package. Keep ticket output parsing in that package and test it against the pinned release. Upstream machine-readable readiness output can be proposed separately if needed.

The inspected MCPWire host creates an MCP child process per peer and kills it on disconnect. Therefore each shared MCP server is a thin adapter to a persistent local daemon, through a local IPC endpoint with restricted permissions. A second peer must share the same worker and concurrency budget. A disconnected adapter must not lose the underlying request's durable terminal state or result.

The buyer facade acts as an MCP client to a `join` subprocess while exposing a single stable MCP server to the buyer agent. It performs provider handoff internally; do not depend on an agent client dynamically installing MCP servers.

MCPWire supplies encrypted peer connectivity and its tool/session controls. Panas supplies explicit application identity proofs, paid authorization, replay protection, argument validation, accounting, and workload admission. Possession of a ticket does not establish the expected buyer or provider identity.

## Provider readiness

Every launch begins in `testing`. The capability suite checks supported OS/architecture, memory/disk prerequisites, runtime/model revisions, load and smoke generation, request bounds, timeout/cancellation, exposure, and separate-peer connectivity. Missing models require explicit setup rather than silent downloads at launch.

A signed report identifies a startup ID, versioned test fixture, model digest, runtime revision, tested profile, measured performance, and pass/fail evidence. This is a provider assertion, not trusted hardware attestation.

Only fresh passing reports with an unexpired heartbeat enter ready-only discovery. Prototype defaults are a 15-second heartbeat and 45-second expiry. Sleep/wake, critical failure, and changed model/runtime invalidate readiness and require retesting. A local self-test alone cannot establish peer reachability.

## Transaction and durable state

1. Buyer filters the live registry by model, price ceiling, request bounds, and performance.
2. Control plane issues a short-lived versioned fixed quote. Discovery is not a capacity reservation.
3. An idempotent purchase atomically reserves the fixed total within owner-authorized limits, returning a signed entitlement and private connection descriptor.
4. Buyer facade joins MCPWire and sends a signed operation envelope. Provider authenticates the buyer, entitlement, expected provider/startup, request binding, and limits.
5. Daemon rechecks local readiness and device-wide admission, then runs bounded inference.
6. Daemon records a durable terminal state and encrypted retrievable result before reporting completion. Ledger settles a successful request once; failures/cancellation release funds. Uncertain outcomes enter reconciliation.

Prototype envelope defaults: one active request, queue depth two, 2,048 context tokens including template overhead, 128 output tokens, and a 60-second execution deadline. The startup suite must validate the advertised profile.

Cancellation before the durable completion decision is free; cancellation after it returns the completed charge. A buyer disconnect does not automatically rerun work; retrieve the original state after reconnect. Provider failure, deadline expiry, or unrecoverable charged-result loss produces a release/refund under the prototype policy. Keep admission, generation, and accounting deadlines explicit.

Use integer atomic money units and immutable price versions. Ledger entries balance buyer debit, provider earnings, and disclosed fees. Idempotency covers purchases, request execution, settlement, refunds, and payment callbacks. Never assume exactly-once execution across process/network failures.

## Trust and privacy

Use platform-signed entitlements, buyer proof-of-key possession over operation/payload digest/request/expiry, and provider-signed responses. Validate key identity at the application layer; the adapter cannot assume transport peer identity is passed into its child process.

Do not place reusable secrets into tool arguments or logs. MCPWire can log argument previews; use opaque grant references and a reviewed session/envelope design. Confirm actual logging behavior in integration tests. Public capabilities exclude tickets, serial numbers, precise location, secrets, prompts, and buyer activity.

The native inference runtime binds to loopback and exposes only approved model operations through the daemon. It receives text data, never arbitrary code, images, shell commands, or model-generated tool executions. Process supervision is not a hostile-code sandbox and does not promise hard unified-memory/GPU partitioning. Providers can inspect workloads on their own hardware despite encrypted transport.

## Volcano boundary and rollout

Use supported Volcano primitives for the registry/API, remote discovery interface, Postgres state, background reconciliation, and Next.js informational frontend. Validate MCP transport/authentication, transactional behavior, scheduling, secret handling, and deployment limits in the deployment lane. Cloud sandboxes do not isolate local Mac inference.

Control-plane failure rejects new purchases. Existing authorized requests may finish within their existing reservation/deadline and reconcile their durable receipts later. Start with test credits. Optional blockchain integration follows a payment adapter and does not change fixed-price contracts or prove execution honesty.

The first complete demo uses two Macs and one buyer agent: discover both, select an eligible provider, purchase one bounded request, run through MCPWire, and retrieve matching receipt/accounting state after a reconnect.

## Toolchain baseline

The foundation uses pnpm 12.16.1, Node.js 24, Next.js 16.4.3, React 19.3.1, Tailwind CSS 4.3.3, Turborepo 2.11.10, and Vitest 5.0.5. TypeScript is pinned to 6.0.3 because the current typescript-eslint peer range is below 6.1; moving to TypeScript 7 requires supported tooling rather than suppressing peer constraints. MCPWire is pinned to @mcpwire/cli 1.1.1 and invoked through its public binary.

## Required public-provider isolation

The public provider path now requires the two-container [Docker boundary](docker-sandbox.md): gateway with peer/cloud egress, worker with networking disabled, CPU-only small-model inference and no native fallback. Earlier native execution descriptions and validation records are historical. Gateway credentials never enter the worker; treasury keys never enter either container.
