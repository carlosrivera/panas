# Volcano deployment foundation

The dedicated cloud project is `panas` (`7db5f8f4-c378-4ba5-a48f-f435bc4c034b`). No other Volcano project should receive Panas deployments. The old GitHub repo `carlosrivera/panas-ai` is separate and must not be modified for this project.

The source layout uploads the workspace root and selects `apps/web` as the frontend app root. The root and app pin pnpm 12.16.1 and Node.js 24. Frontend and health-function variable scopes are empty; do not broaden them to all project variables.

```sh
volcano use 7db5f8f4-c378-4ba5-a48f-f435bc4c034b
volcano projects get 7db5f8f4-c378-4ba5-a48f-f435bc4c034b
pnpm install --frozen-lockfile
pnpm check
volcano cloud deploy --no-env-file
```

Run `volcano cloud deploy --help` against the installed CLI before deploying; flags and runtime behavior must match current official docs. The function remains private. `apps/web/app/api/health` is a frontend health route, separate from the private cloud function.

Verify deployment status, deployed frontend health, and actual page response before reporting success. Database, remote MCP authentication, registry, accounting, and scheduled reconciliation are follow-up issues; the health scaffold does not implement them. Native inference and MCPWire host processes run on the Mac, outside Volcano.

Official references: [frontend deployment](https://docs.volcano.dev/platform/frontends/deploy), [Volcano documentation](https://docs.volcano.dev/). The same corpus is available through `volcano docs search` and `volcano docs get`.

## Verified foundation deployment

The initial informational frontend is deployed at https://b694dc37-574c-4668-adf0-9371a728f16f.frontends.volcano.run/. The cloud build succeeded with Node.js 24.11.1 and pnpm 12.16.1. The health handler uses ESM exports to match the workspace package type. Provisioned/active status alone does not establish a healthy invocation; verify the actual response.
