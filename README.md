# 🤝 Panas AI

### Distributed inference. Shared computers. No dedicated inference data center.

**Panas turns shared computers into peer-to-peer inference infrastructure that AI agents can discover and use through MCP.** Providers contribute compute and choose free access or a fixed price. Buyers authorize bounded requests within owner-set limits. Encrypted peer channels carry inference; Solana devnet USDC provides the implemented blockchain payment rail.

_Panas means friends. We're building a way for their computers to help each other, too._

[Explore the website](https://b694dc37-574c-4668-adf0-9371a728f16f.frontends.volcano.run/) · [Try the prototype](#try-the-prototype) · [See the evidence](#what-we-have-demonstrated) · [Technical documentation](#technical-documentation)

## Your agent needs compute. Your pana has it.

Sharing a model usually means configuring an endpoint, granting access, and figuring out who can use it and how much. An agent needs those decisions expressed as tools it can call.

Panas brings discovery, authorization, peer connectivity, and fixed-price accounting into one MCP interface. A provider contributes a bounded inference service; a buyer agent finds it and requests work within its owner's limits. The website explains the network. The agent uses it directly.

Instead of provisioning a dedicated inference fleet, Panas routes requests to participating providers. Compute stays at the edge; Volcano supplies the shared registry and accounting control plane. This is a peer-to-peer inference data path with centralized coordination, rather than a claim that every component is decentralized.

We chose Macs because that is the hardware our team has. The current provider launcher targets Apple Silicon Macs, while the gateway and inference worker run in Linux ARM64 Docker containers. That separation creates a path to testing other Docker hosts; additional host/architecture support still needs launcher and runtime validation. **The buyer does not need a Mac or a local model**: it needs the Node.js buyer MCP facade and a compatible agent client. macOS and Linux process supervision are supported; Windows process-tree supervision is outside the current support matrix.

The prototype starts with one pinned small model and bounded text requests. Larger models and a broader provider network build on the same discover → quote → authorize → connect → infer → receipt transaction.

## From discovery to receipt

```text
BUYER AGENT                  VOLCANO CONTROL PLANE               PROVIDER MAC
     │                       registry · quotes · ledger               │
     ├── discover + quote ───────────►│                               │
     ├── purchase within owner caps ►│                               │
     │◄── signed access grant ───────┤                               │
     │                                                               │
     ├──────── encrypted MCPWire peer connection ────────────────────►│
     │                                       gateway → Ollama worker │
     │◄────────────────── result + receipt ──────────────────────────┤
```

The buyer exposes one stable MCP server to its agent. Panas handles the provider connection internally, so each purchase does not require manually adding another MCP server.

| Agent tool                            | What it does                                               |
| ------------------------------------- | ---------------------------------------------------------- |
| `discover_providers` / `get_provider` | Find and inspect providers, capabilities, and readiness    |
| `quote_inference`                     | Obtain a fixed quote for a bounded request                 |
| `purchase_access`                     | Reserve the accepted amount within owner-configured limits |
| `run_inference`                       | Connect to the provider and submit the authorized request  |
| `get_request` / `cancel_request`      | Retrieve the original outcome or request cancellation      |

## Infrastructure built for agent workloads

- **Agents are the customers.** Structured discovery and purchase tools put shared inference inside an agent workflow.
- **Providers keep control.** Startup checks, heartbeat expiry, bounded generation, and device-wide admission govern when work is accepted.
- **Price is agreed before execution.** A successful bounded request has a fixed charge. Token counts support limits and diagnostics.
- **Reconnects have a memory.** Durable request state, encrypted stored results, idempotent purchases, and receipt retrieval support recovery without blindly rerunning work.
- **Cloud coordination, peer inference.** Volcano coordinates discovery and accounting. Prompt and response content travel over the buyer-to-provider path. Providers can inspect workloads on their own machines.

The current public provider path separates an internet-facing Docker gateway from a network-disabled inference worker. It runs the small model on CPU with resource bounds and no native fallback. See [isolation details](docs/docker-sandbox.md).

## Encrypted transport, explicit authorization

Encryption protects the channel; signed application messages establish who may do what.

- **Encrypted peer channels:** MCPWire carries MCP calls between buyer and provider. Prompts and outputs bypass the cloud control plane; quotes send a payload digest and request bounds. Connection descriptors remain private and are excluded from public listings and agent-visible tool results.
- **Ed25519 signatures:** platform-signed grants bind buyer, provider, startup, quote, request, model, payload digest, limits, amounts, and deadlines. Buyer operation proofs and provider response proofs use separate signing domains and canonical JSON. The buyer verifies response identity and request/nonce bindings.
- **Replay protection:** signatures work alongside nonce checks, expiry, durable request state, and idempotency. A copied transport ticket alone grants no inference authority.
- **AES-256-GCM at rest:** buyer request state and provider stored results are encrypted locally; private connection descriptors are also encrypted in the accounting service. Local keys and application state use restricted filesystem permissions.
- **Bounded execution:** one worker, a bounded queue, output limits, deadlines, and owner request/session/day spending caps constrain work independently of transport connectivity.
- **Separated containers:** the gateway owns connectivity and provider credentials; the inference worker has networking disabled and receives no provider or treasury private keys. Both run non-root with read-only roots, dropped capabilities, seccomp, and CPU/memory/PID limits.

Transport encryption does not hide workloads from the provider operating the machine. Signatures attribute messages; they do not prove honest inference or hardware identity. See the [authorization protocol](docs/authorization-protocol.md), [transport adapter](docs/transport.md), and [Docker boundary](docs/docker-sandbox.md).

## Blockchain payments on Solana

**Implemented: prepaid USDC payments on Solana devnet, integrated with fixed-price inference accounting.** Providers can offer free access or publish a price in devnet USDC. TEST_CREDIT remains an internal testing rail.

1. The buyer creates a funding intent with an exact amount and buyer-bound memo.
2. The owner sends devnet USDC to the treasury token account and submits the public transaction signature. Wallet private keys never enter MCP tools.
3. The backend independently verifies the devnet cluster, finalized transaction, canonical USDC mint, recipient, exact amount, and memo. A transaction can credit the prepaid balance only once.
4. Purchase reserves the quoted amount. Durable successful completion settles buyer debit, provider earnings, and fee in a balanced append-only PostgreSQL ledger. Definitive failure/cancellation releases the hold; uncertain work remains pending reconciliation.

Amounts use integer atomic units, with six decimals for USDC. Accounts and ledger entries retain their asset; funding cannot increase the owner's spending caps. Refund accounting appends compensating entries rather than rewriting history.

The rail uses **devnet test tokens**. Mainnet payments, automated on-chain provider payouts, and wallet withdrawals are outside the current implementation. A funded on-chain transfer plus inference drill is separate from the recorded test-credit runs. See [payment protocol and setup](docs/payments.md) and [validation records](docs/validation/free-and-devnet.md).

## What we have demonstrated

The repository includes concrete execution records alongside the implementation:

| Demonstration                                      | Recorded result                                                                                                                                                            | Evidence                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Discovery → purchase → MCPWire inference → receipt | An earlier native build used the real cloud control plane and two logical providers on one Mac. One request produced 16 output tokens and a balanced 1 TEST_CREDIT charge. | [Run artifact](docs/integration/evidence/release-smoke-2026-10-29.json)      |
| Reconnect and duplicate protection                 | A replacement buyer adapter retrieved the original receipt; repeated purchase retained the request and repeated execution was rejected in that run.                        | [Same run artifact](docs/integration/evidence/release-smoke-2026-10-29.json) |
| Free inference                                     | An earlier native build completed a real peer request for a zero-balance buyer with a zero-charge receipt.                                                                 | [Free-access validation](docs/validation/free-and-devnet.md)                 |
| Docker worker isolation and inference              | The newer local Docker build generated eight actual output tokens, passed cancellation/restart checks, and denied tested host-file, key, socket, and network access.       | [Docker validation](docs/validation/docker-sandbox.md)                       |

The next acceptance milestone combines the Docker provider, peer inference, and accounting across **two physical Macs**. Physical sleep/wake, accepted-work crash recovery, and an actual deployed-service outage remain open validation work. The [failure matrix](docs/integration/failure-matrix.md) distinguishes observed runs from component tests.

## Try the prototype

This is an enrolled hackathon prototype. An operator supplies provider and buyer configuration before use; [setup instructions](docs/distribution.md) cover identities, the approved model, Docker image, and credentials. Providers require Apple Silicon macOS 14+, Docker Desktop, and the pinned model. The CLI requires Node.js 24.

The documented alpha.4 installer URL currently returns HTTP 404. Until the matching CLI and Docker image are published and verified, use an operator-prepared build for the demo; source setup is below. The commands here assume that prepared CLI and completed enrollment.

After the operator handoff, start a free provider on the provider Mac:

```sh
~/.local/bin/panas provider --free
```

Wait for `state: ready` and `peerProbe: verified`. On the configured buyer computer, print the agent setup prompt:

```sh
~/.local/bin/panas demo-prompt
```

Copy the output into Codex to configure the buyer MCP and request one free bounded inference. The generated prompt authorizes no spending and requires a real provider and receipt. If no provider is available, the run stops.

For the Solana devnet flow, use a separately enrolled devnet-USDC buyer and the [payment setup](docs/payments.md):

```sh
~/.local/bin/panas provider --solana-devnet --price-atomic 10000
~/.local/bin/panas demo-prompt --paid
```

Run the provider command on the provider host; run the prompt command on the buyer computer. `10000` atomic units is 0.01 devnet USDC per successful bounded request.

## Built with

| Layer              | Technology and responsibility                                                     |
| ------------------ | --------------------------------------------------------------------------------- |
| Agent interface    | Model Context Protocol; stable buyer facade and disposable provider adapters      |
| Peer connection    | External, pinned MCPWire CLI for encrypted connectivity                           |
| Inference          | Pinned Ollama and `qwen2.5:0.5b`; current Docker path uses CPU                    |
| Provider lifecycle | Persistent daemon, capability checks, workload admission, encrypted durable state |
| Cloud              | Volcano registry and accounting services; PostgreSQL ledger and receipts          |
| Blockchain         | Solana devnet USDC; verified prepaid deposits and asset-bound settlement          |
| Website            | Next.js and React                                                                 |

Panas adds provider readiness, signed authorization, bounded execution, and accounting around MCPWire's transport. A connection ticket alone does not authorize inference.

## Develop locally

Use Node.js 24 and pnpm 12.16.1, pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The website runs at <http://localhost:3333>. Provider operation requires the additional [provider setup](docs/distribution.md).

```sh
pnpm format:check
pnpm check
pnpm provider:doctor
```

`provider:doctor` checks local Docker capabilities against the installed pinned model. Publishing readiness also requires a separate-peer probe.

[Architecture](docs/architecture.md) · [Distribution](docs/distribution.md) · [Deployment](docs/deployment.md) · [Integration evidence](docs/integration/README.md) · [Contributing instructions](AGENTS.md) · [MIT license](LICENSE)

## Technical documentation

These documents and implementation paths are checked into this repository so judges can inspect the engineering behind the demo:

| Topic                                        | Documentation                                                                                                     | Implementation                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| System design and boundaries                 | [Architecture](docs/architecture.md), [PRD](docs/PRD.md)                                                          | [Provider](apps/provider/src), [buyer MCP](apps/buyer-mcp/src), [provider MCP](apps/provider-mcp/src) |
| Container isolation and resource controls    | [Docker boundary](docs/docker-sandbox.md), [observed validation](docs/validation/docker-sandbox.md)               | [Docker build](docker), [provider launcher](apps/cli/src/docker-provider.ts)                          |
| Signed grants, proofs, and replay protection | [Authorization protocol](docs/authorization-protocol.md)                                                          | [Protocol package](packages/protocol/src)                                                             |
| Encrypted peer connection and lifecycle      | [Transport adapter](docs/transport.md)                                                                            | [MCPWire adapter](packages/mcpwire/src)                                                               |
| Solana deposits and asset-bound settlement   | [Payments](docs/payments.md), [validation](docs/validation/free-and-devnet.md)                                    | [Accounting](packages/accounting/src), [SQL migrations](volcano/migrations)                           |
| Readiness and discovery                      | [Registry](docs/registry.md), [public provider API](docs/public-provider-api.md)                                  | [Registry package](packages/registry/src)                                                             |
| Faults, reconnects, and acceptance evidence  | [Failure matrix](docs/integration/failure-matrix.md), [two-machine procedure](docs/integration/two-machine.md)    | [Recorded evidence](docs/integration/evidence)                                                        |
| Installation and cloud operation             | [Distribution](docs/distribution.md), [deployment](docs/deployment.md), [operations](docs/platform/operations.md) | [CLI](apps/cli/src), [platform scripts](scripts/platform)                                             |

Some design documents retain earlier native-runtime or test-credit-only descriptions. For the current Docker and Solana paths, follow the dedicated Docker and payment documents linked above; the evidence records identify the build and topology actually exercised.
