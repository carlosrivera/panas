# Volcano deployment

The dedicated cloud project is `panas` (`7db5f8f4-c378-4ba5-a48f-f435bc4c034b`). No other Volcano project should receive Panas deployments. The old GitHub repo `carlosrivera/panas-ai` is separate and must not be modified for this project.

For the current release, use `pnpm platform:deploy` from a clean configured checkout; see [operations](platform/operations.md) for tracked migrations, scopes and verification. The commands in the foundation section below describe the initial scaffold, not the current full-release procedure.

## Historical foundation setup

The source layout uploads the workspace root and selects `apps/web` as the frontend app root. The root and app pin pnpm 12.16.1 and Node.js 24. Frontend and health-function variable scopes are empty; do not broaden them to all project variables.

```sh
volcano use 7db5f8f4-c378-4ba5-a48f-f435bc4c034b
volcano projects get 7db5f8f4-c378-4ba5-a48f-f435bc4c034b
pnpm install --frozen-lockfile
pnpm check
volcano cloud deploy --no-env-file
```

Run `volcano cloud deploy --help` against the installed CLI before deploying; flags and runtime behavior must match current official docs. The function remains private. `apps/web/app/api/health` is a frontend health route, separate from the private cloud function.

Verify deployment status, deployed frontend health, and actual page response before reporting success. The initial health scaffold did not implement registry/accounting or maintenance. Those now exist as separate services; the legacy health response is still not financial/database health. Current inference and MCPWire processes run in worker/gateway Docker containers on provider Macs, outside Volcano. The cloud coordinates encrypted peer inference without hosting model execution.

Official references: [frontend deployment](https://docs.volcano.dev/platform/frontends/deploy), [Volcano documentation](https://docs.volcano.dev/). The same corpus is available through `volcano docs search` and `volcano docs get`.

## Historical foundation deployment

The initial informational frontend is deployed at https://b694dc37-574c-4668-adf0-9371a728f16f.frontends.volcano.run/. The cloud build succeeded with Node.js 24.11.1 and pnpm 12.16.1. The health handler uses ESM exports to match the workspace package type. Provisioned/active status alone does not establish a healthy invocation; verify the actual response.

## Release verification and diagnostics

Use `pnpm platform:deploy` for the current control-plane and website release; the foundation-only commands above describe the initial scaffold. The script checks the pinned toolchain, repository, project and database migrations before invoking the CLI. A deployment is verified only after authenticated discovery, authorization boundaries, operational release identity, financial invariants, the public page and its built assets pass.

The frontend probe allows up to three minutes for bounded network/HTTP readiness failures and management status to converge. Each attempt fetches the public landing page again and checks **every** referenced same-origin Next.js asset, so a retry cannot silently skip a broken chunk or keep probing only a superseded HTML snapshot. External asset URLs, HTML masquerading as an asset, wrong release identity and nonzero financial invariant counts fail closed.

CI prints separate `frontend`, `frontend_assets` and `frontend_deployment` stages. `artifacts/verification.json` retains bounded failure codes, public paths without query strings and HTTP status; raw errors, credentials and response bodies are excluded. A successful `artifacts/release.json` also records asset count and frontend attempt count. Artifact upload runs on failure as well as success, while maintenance runs only after release verification succeeds.

Pushes to `main` deploy the full test project. The legacy platform bootstrap branch and dispatches from other refs remain functions-only. Dispatch from `main` to verify the full workflow, including frontend checks:

```sh
gh workflow run platform.yml --repo carlosrivera/panas --ref main
```

Volcano documents deployment and edge readiness separately from a serving previous version: [frontend status](https://docs.volcano.dev/platform/api-reference/frontend-endpoints), [frontend deployment](https://docs.volcano.dev/platform/frontends/deploy). A green deployment job must include verification and maintenance; active resource metadata alone is insufficient.

Backend function resource metadata has its own bounded readiness stage, `functions_deployment`. The CLI can report a deployment operation active before a subsequent resource-list read observes every function as active. The verifier waits on that metadata and identifies any function that remains unready; it then invokes operational health once and checks the exact release revision and financial invariants without retrying those semantic failures.

Migration files are executed as individual PostgreSQL statements within the existing advisory-locked transaction. This supports the managed endpoint's single-statement request restriction while preserving dollar-quoted function bodies, comments, file checksums and atomic tracker updates. Never split migration files with a plain semicolon operation or edit an already tracked migration to work around endpoint restrictions.
