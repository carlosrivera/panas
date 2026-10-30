# Panas test platform

The platform supports free access, prepaid Solana devnet USDC and internal TEST_CREDIT regression accounting. Devnet funding requires the matching migrations/services and configured public treasury values. Inference and MCPWire share/join processes run in separate worker/gateway Docker containers on provider Macs; the buyer does not require a Mac. The cloud is discovery, authorization, accounting and an informational website; it provides no device sandbox or hardware attestation.

The committed `.volcano/project.json` binds every release to project `panas`, `7db5f8f4-c378-4ba5-a48f-f435bc4c034b`. Deployment refuses another project override, an account-wide token, a dirty checkout, or a different CLI/runtime family. Node 24, pnpm 12.16.1 and Volcano CLI 0.55.0 are checked; exact framework/dependency versions come from the committed pnpm lockfile. The frontend source layout uploads the workspace root with app root `apps/web`. Generated bundles use function-local Git ignores; root ignores also affect Volcano upload and must not hide a function entrypoint or its isolated manifest. The runtime supports Next 16; the actual built version and runtime patch are recorded in release evidence.

| Service    | Address                                                            | Authorization                                                                                          |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Registry   | https://cdb5c197-93ad-4c13-8dca-45e1d18140f5.functions.volcano.run | Public `/public/providers`; bearer read credential for `/providers` and `/mcp`; signed provider writes |
| Accounting | https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run | Signed buyer/provider requests                                                                         |
| Website    | https://b694dc37-574c-4668-adf0-9371a728f16f.frontends.volcano.run | Informational public read only                                                                         |
| Operations | Discovered by name through the project management API              | Private project-token invocation                                                                       |

## Credentials and scopes

GitHub environment `panas-test` contains only `VOLCANO_TOKEN` and `PANAS_DISCOVERY_TOKEN`. The first is a dedicated 90-day project access token with `full` rights in this single project; Volcano currently offers project `full`/`read_only`, not narrower deployment-only permissions. The read credential only probes actual MCP discovery. Project management tokens cannot invoke functions directly. A separate dedicated project service key named `panas-operations` is created if missing and retrieved in memory for private RPC invocation; it has project admin data access, is never copied to GitHub/browser/runtime variables or logs, and is only used against a function ID whose project/name were verified. Rotate it through the service-key regenerate API; each invocation fetches the current key. An account-wide login credential is never copied into CI. Existing database, descriptor-encryption and platform-signing keys stay in project variables, fetched in memory when migrations need the database. Never run these commands with `--debug` or print variable/API response bodies.

| Runtime    | Explicit variable allowlist                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| registry   | `PANAS_REGISTRY_DATABASE_URL`, `PANAS_DISCOVERY_TOKEN_SHA256`                                                                                                                                                        |
| accounting | `PANAS_REGISTRY_DATABASE_URL`, `PANAS_PLATFORM_PRIVATE_KEY_BASE64`, `PANAS_DESCRIPTOR_KEY_BASE64`, `PANAS_SOLANA_DEVNET_RPC_URL`, `PANAS_SOLANA_DEVNET_TREASURY_OWNER`, `PANAS_SOLANA_DEVNET_TREASURY_TOKEN_ACCOUNT` |
| operations | `PANAS_REGISTRY_DATABASE_URL`                                                                                                                                                                                        |
| health     | none; this legacy foundation response is not database health                                                                                                                                                         |
| frontend   | `PUBLIC_REGISTRY_URL` only, a nonsecret server read base                                                                                                                                                             |

The manifest deliberately omits a project-wide variables section: that section would delete absent variables. Deployment upserts `PUBLIC_REGISTRY_URL` with `shared:false` and initializes missing public Solana devnet values from `volcano/devnet-payments.json`, preserving existing operator values, then applies explicit runtime scopes. No treasury private key is deployed. No discovery credential, buyer identity, enrollment key, ticket, ledger or signing key belongs in browser configuration.

Token `panas-github-deploy` (ID `6a06b88a-e049-4146-aa68-ba2724a28b5a`) expires 2027-01-27T04:19:50Z. Before expiry, an account owner creates a replacement project token through `volcano cloud access-tokens create`, captures it privately, updates the environment secret through stdin, validates a deployment, then revokes the previous ID. Token creation/revocation requires the owner's account credential; CI cannot administer tokens. Do not rotate the signing or descriptor keys during routine deployment: in-flight grants and stored encrypted descriptors depend on them.

## Reproduce a deployment

Start from a clean committed checkout. Use Node 24 and the pinned pnpm. A mode-600 ignored `.env.platform.local` must contain the project access token and the read-only discovery token; no database URL is needed for normal release commands.

```sh
pnpm install --frozen-lockfile
node --env-file=.env.platform.local --import tsx scripts/platform/deploy.ts --functions-only
```

The command checks versions and cleanliness, runs formatting and repository checks/builds, bundles Node 24 ESM functions with isolated dependency manifests, applies tracked migrations, validates manifest actions, deploys and waits, then verifies remote behavior. Omit `--functions-only` to include the frontend after its changes are ready. No raw environment file is uploaded. Do not use `volcano cloud deploy --with-migrations`: that built-in path reruns every SQL file without tracking.

`.github/workflows/platform.yml` performs the same operation on main/manual runs. The explicitly controlled `codex/issue-9-platform` push branch runs backend-only deployment while website PRs are pending. It never runs with deployment secrets for pull-request events. GitHub concurrency prevents overlapping workflow deployments. Coordinate local operator deployments with CI.

Successful verification writes ignored `artifacts/release.json`, or `artifacts/backend-release.json` for backend-only runs. It records the clean source commit, lockfile checksum, actual tool versions, active deployment IDs, tested service URLs and individual passing checks. Verification includes anonymous schema/CORS/cache checks, rejected unsigned access, an official authenticated MCP client/tool call, private financial-invariant health, and frontend HTML/built assets for full releases. An `active` status alone is insufficient. Remote probes have three bounded attempts with ten-second gaps to allow routing/readiness propagation after activation; no release is verified if those checks still fail. Probe labels are logged without response bodies or credentials. Backend-only proof does not satisfy the full website release gate. Release evidence is operational evidence, not a cryptographic source attestation or proof of two physical Macs.

## Migrations and existing data

`pnpm platform:migrate` uses one transaction and a PostgreSQL advisory lock. `panas_schema_migrations` tracks filename, exact SHA-256, source release, application time and whether a migration was explicitly adopted. Edited or removed applied files are rejected. Normal deploy refuses an existing untracked application schema. Add a forward migration for all future changes; never edit old SQL, reset the ledger, or invent a down migration.

This project's previously deployed migrations 010–043 predate the tracker. One explicit operator adoption is approved in `volcano/migration-baseline.json`, including each original checksum and a clean PostgreSQL 17 schema fingerprint. Adoption checks tables/RLS, columns, constraints, indexes, functions, triggers and ledger balance validation, records an append-only operator audit, and records those old files without replaying their DDL. After adopting that historical baseline, the runner applies all remaining unapplied migrations in order, including the devnet/free-access migrations 047–051. Adoption does not imply that a particular deployed release includes the newest schema; inspect its release evidence. Run once with private project credentials:

```sh
node --env-file=.env.platform.local --import tsx scripts/platform/migrate.ts --adopt-existing-baseline
```

A second adoption attempt is rejected. Ordinary deployment never supplies this flag. Financial balances, receipts and keys are preserved.

The empty-database path was exercised on the disposable `platform_empty_check` branch, not the live database. `scripts/platform/test-database.ts --reset-isolated-branch` is an explicitly destructive fixture tool outside deployment: before resetting its schema it checks the exact connection against the management API, fixed project, source database association, branch name/ID/role, active state and <=2-hour TTL. It rejects another production role even when its username differs. It never rewrites the approved fingerprint. `PANAS_MIGRATION_DATABASE_URL` is allowed by the migration CLI only with `--isolated-test`; do not set it in deployment jobs.

## Maintenance and health

Volcano rejected a disabled scheduler probe with HTTP403 `plan_required`: scheduled functions are unavailable on the current plan. No plan upgrade was made. `.github/workflows/maintenance.yml` instead invokes the private operations function hourly, at minute zero UTC. GitHub schedules can be delayed and activate only after this workflow reaches the default branch. The deployment workflow exercises the identical `maintain.mjs` routine after a successful backend deployment; a standalone manual maintenance workflow becomes available after merge.

The worker uses `FOR UPDATE SKIP LOCKED`, at most100 rows per invocation, to move overdue `reserved`/`authorized` requests to `pending`. It never debits, refunds, releases holds, manufactures terminal events, or infers failure from a missing heartbeat. Repeated/concurrent calls are safe. Provider-signed terminal reports and audited operator decisions remain the settlement authority. Read-time registry heartbeat/report expiry remains authoritative; no cron job revives providers or controls readiness.

Private health reports source revision, observation time, overdue count, ledger imbalance count and buyer held-total mismatch count. All counts use one SQL snapshot. A pending-review flag can be true while financial invariants remain healthy. Financial inconsistencies fail the maintenance workflow; overdue requests need owner review, not automatic release. Maintenance acknowledgments require a nonnegative integer `markedPending` (health-only responses are rejected); a second private health call verifies the committed reconciliation summary timestamp. The last maintenance summary is stored in `panas_platform_operations` and a nonsecret CI artifact. The legacy `health` function is only foundation metadata.

## Incident and rollback

1. Preserve private logs, request IDs, signed terminal events and receipts. Do not log raw prompts/tickets/keys. Inspect private operations health and the latest maintenance/release artifacts.
2. During control-plane failure, new purchases and new execution authorization fail closed. Existing authorized work keeps its durable terminal outbox and retries the same event after recovery. Never rerun uncertain inference to resolve a missing receipt. Integration evidence must label a fault-proxy drill separately from an actual deployed outage.
3. For ledger/held mismatches, stop new work through operator owner/provider policy controls and investigate. Reconcile uncertain requests using the existing audited accounting operator procedure; no scheduled financial correction is permitted.
4. The current CLI has no previous-version activation command for functions. To roll back application code, create an isolated checkout of a known compatible source commit, install its frozen lockfile, preserve the current fixed project link and project token, rebuild only the affected function and run `volcano cloud functions deploy -f registry` (or `accounting`). Wait for active status and exercise the actual API/MCP. Do not deploy an old variables manifest or rerun its migrations. The current schema tracker and all data stay in place. A frontend rollback similarly requires rebuilding/uploading the known source; `frontends redeploy` only repeats the latest archive.
5. Keep the platform signing and descriptor encryption keys unchanged across rollback. Record the mixed source/deployment IDs as an incident release; standard full-release proof should be regenerated only after a coordinated clean release. Restore forward with a compatible release and a forward migration if needed.

Official behavior references are available via the pinned CLI: `volcano docs get cli/deploy.md`, `cli/access-tokens.md`, `platform/databases/branching.md`, `platform/functions/scheduled-invocations.md`, and `platform/api-reference/functions.md`.
