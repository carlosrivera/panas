# Panas AI

Agent-discovered inference on shared Macs, powered by MCPWire. Repository: `carlosrivera/panas`.

This is the foundation for the prototype, not a working compute marketplace. The informational site and health endpoints run; shared validation schemas and MCPWire command adapters are implemented. Discovery, paid entitlements, durable accounting, real inference serving, and peer lifecycle integration are tracked in GitHub issues.

## Requirements and setup

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

`provider:doctor` checks the local platform and installed Ollama model without downloading anything or exposing a provider. It intentionally exits nonzero until the full capability suite is implemented: passing local prerequisites alone must not make a provider discoverable. Install the proposed model explicitly with `ollama pull qwen2.5:0.5b` when working on the provider issue.

## Workspace

| Path                                                   | Responsibility                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `apps/web`                                             | Next.js informational frontend and `/api/health`                                |
| `apps/provider`                                        | Local provider startup diagnostic; persistent daemon follows                    |
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
