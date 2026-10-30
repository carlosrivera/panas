# 🤝 Panas AI

### Your agent needs compute. Your pana has it.

**Turn the computers people already own into inference infrastructure for AI agents.**

Panas connects agents that need inference with people who have compute to share. An agent discovers a provider through MCP, accepts a fixed quote, runs inference over an encrypted peer connection, and gets a result with a receipt. Providers choose when to share and whether to offer their compute for free or charge for it.

**Distributed inference. Encrypted channels. Agent-native access. No dedicated inference data center.**

[Explore Panas](https://panas.mcpwire.co/) · [Connect your agent](docs/distribution.md) · [Read the architecture](docs/architecture.md)

## The network is already on your desk

A developer has a computer with spare capacity. Somewhere else, an agent needs a model. Putting them to work together should be a tool call.

Panas makes shared inference discoverable, accessible, and accountable. The provider publishes its model, availability, limits, and price. The buyer agent finds a match and requests work within the budget its owner has authorized. Panas handles the connection and transaction behind one stable MCP interface.

We’re building the inference network out of computers people already own.

## One agent. A network of panas.

```text
Discover a provider → Get a quote → Authorize → Run inference → Get a receipt
```

The agent uses `discover_providers`, `quote_inference`, `purchase_access`, and `run_inference`. Panas connects to the selected provider automatically. `get_request` retrieves the original result and receipt after a reconnect.

**No per-provider MCP setup. No model on the buyer’s machine. No browser checkout in the agent’s way.**

## Built to share compute across real machines

| What we built                                   | Why it matters                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP interface for agents**                    | Discovery, quotes, execution, funding, and retrieval are tools the agent can use.                                                              |
| **Encrypted P2P inference with MCPWire**        | Prompts and outputs move between buyer and provider. The cloud coordinates discovery and accounting.                                           |
| **Docker gateway + offline inference worker**   | The gateway handles connectivity and authorization; the worker runs the model with networking disabled and bounded CPU, memory, and processes. |
| **Ed25519 authorization + AES-256-GCM storage** | Signed grants bind work to the buyer, provider, model, limits, and price. Stored private request state and results are encrypted.              |
| **Fixed-price accounting and durable receipts** | Reserve before execution, settle successful work once, and retrieve the original outcome after interruption.                                   |
| **Solana devnet USDC payments**                 | Providers can charge for inference through verified prepaid deposits and asset-bound settlement. Free sharing is available too.                |

The control plane runs on Volcano with PostgreSQL. Inference runs on participating providers. MCPWire supplies the encrypted peer transport; Panas supplies discovery, authorization, workload control, and accounting.

## Share it free. Put a price on it.

Start a community provider:

```sh
panas provider --free
```

Or publish a fixed price of 0.01 devnet USDC per successful bounded request:

```sh
panas provider --solana-devnet --price-atomic 10000
```

The owner funds a prepaid balance through Solana. Panas verifies the finalized transfer, recipient, amount, and buyer-bound memo before crediting it once. Inference settlement uses an append-only ledger, and funding never raises the agent’s owner-set spending limits.

The hackathon payment rail uses **Solana devnet test USDC**. [Payment protocol →](docs/payments.md)

## Try Panas

Install Node.js 24, download the [alpha.5 installer](https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.5/install.sh), and follow the [provider and buyer setup](docs/distribution.md) for enrollment, keys, model, and Docker image.

```sh
sh ~/Downloads/install.sh
```

After setup, start a provider:

```sh
~/.local/bin/panas provider --free
```

On the buyer computer, get the agent setup prompt:

```sh
~/.local/bin/panas demo-prompt
```

Paste the output into Codex to connect the MCP facade, discover a provider, and make a free inference request. Use `demo-prompt --paid` with a configured devnet-USDC buyer for the payment flow.

**The buyer does not need a Mac.** The current provider launcher targets our Apple Silicon Macs; its gateway and CPU inference worker run in Linux ARM64 Docker containers. The buyer runs on supported macOS/Linux hosts with Node.js and an MCP client. The hackathon model is pinned `qwen2.5:0.5b`.

## Go under the hood

The engineering is here to inspect:

- [Architecture and component boundaries](docs/architecture.md)
- [Encrypted transport and lifecycle](docs/transport.md) · [Signed authorization protocol](docs/authorization-protocol.md)
- [Docker isolation and resource controls](docs/docker-sandbox.md)
- [Solana payments](docs/payments.md) · [Accounting and ledger](docs/accounting.md)
- [Registry and readiness](docs/registry.md) · [Deployment and operations](docs/platform/operations.md)
- [Integration evidence and validation status](docs/integration/README.md) · [Docker validation](docs/validation/docker-sandbox.md)

The validation records distinguish completed runs, component tests, and remaining physical-host acceptance work. They also document payment and trust boundaries, including devnet scope, wallet payout status, and provider access to workloads.

## Build locally

Node.js 24 · pnpm 12.16.1

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Website: <http://localhost:3333>. Checks: `pnpm format:check` and `pnpm check`. [Provider setup](docs/distribution.md) · [Contributing](AGENTS.md) · [MIT license](LICENSE)

---

_Panas means friends. Your next inference server might already belong to one._
