# Panas AI

Agent-discovered inference on shared Macs, powered by MCPWire. Repository: `carlosrivera/panas`.

The prototype includes agent discovery, fixed TEST_CREDIT purchases, signed entitlements, durable accounting and native Mac inference through MCPWire. Physical two-Mac and recovery acceptance checks remain tracked in issue #10; real payments are disabled.

## Hackathon demo without cloning

Download [install.sh](https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.2/install.sh), run `sh ~/Downloads/install.sh` with Node 24, and complete the [one-time operator setup](docs/distribution.md). Then:

```sh
~/.local/bin/panas provider
~/.local/bin/panas demo-prompt | pbcopy
```

Paste the prompt into Codex to configure the buyer MCP, discover a provider and test one bounded TEST_CREDIT request. The provider runs natively with process supervision; **it is not OS-sandboxed**. See [the isolation limits](docs/distribution.md#isolation-what-this-demo-actually-provides).

## Development requirements and setup

- Node.js 24 (`nvm use` reads `.nvmrc`).
- pnpm 12.16.1, as pinned in `packageManager`. Older Corepack releases may not support pnpm 12’s native launcher; install current pnpm using its official installation method or update Corepack.
- Ollama and Apple Silicon macOS are needed only for provider development, not the website or deterministic CI tests.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The informational site runs at http://localhost:3333. It intentionally displays no simulated live provider inventory.

```sh
pnpm format:check
pnpm check
pnpm provider:doctor
```

`provider:doctor` runs the local capability suite against an explicitly installed, pinned native Ollama/model without publishing a provider. Passing local checks leaves connectivity unverified. The full provider host must also pass its separate-peer probe before readiness publication.

## Workspace

| Path                                                   | Responsibility                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `apps/web`                                             | Next.js informational frontend and `/api/health`                                |
| `apps/provider`                                        | Persistent native worker, capability checks and durable state                   |
| `apps/provider-mcp`                                    | Paid host and disposable per-peer MCP adapter                                   |
| `apps/buyer-mcp`                                       | Stable buyer MCP facade                                                         |
| `apps/cli`                                             | Compiled release command entry point                                            |
| `packages/contracts`                                   | Zod schemas for states, bounded limits, local reports, fixed test-credit quotes |
| `packages/mcpwire`                                     | Pinned external CLI invocation, ticket validation, approved tool allowlist      |
| `packages/ui`                                          | Shared UI primitives and Tailwind CSS                                           |
| `packages/eslint-config`, `packages/typescript-config` | Shared development rules                                                        |
| `volcano/functions/health`                             | Private Volcano health-function scaffold                                        |

The provider daemon, per-peer host MCP adapter, stable buyer MCP facade, and Volcano control plane are separate responsibilities. MCPWire remains an external CLI dependency. No public SDK import or fork is required.

## Team work

Read [AGENTS.md](AGENTS.md), [the PRD](docs/PRD.md), [architecture](docs/architecture.md), and [the issue/dependency plan](docs/team-plan.md). Shared schema changes need consumer coordination. Providers, transport, and registry can start independently once foundations merge.

## Deployment

See [Volcano setup](docs/deployment.md). Local tests and a successful build do not establish that remote resources are deployed. Cloud project IDs are identifiers; credentials and tickets must never enter the repository.

Real payments remain disabled. Fixed test credits are the first accounting adapter; blockchain is optional follow-up work.
