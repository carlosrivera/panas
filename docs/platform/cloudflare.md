# Cloudflare API deployment

The live `panas-api` Worker serves `/registry*` and `/accounting*` on
`panas.mcpwire.co`. The `panas-web-router` continues serving the GitHub Pages
website. Existing clients retain their URLs and signing trust anchors.

PostgreSQL remains the same Volcano database. Keep its full connection string,
including TLS and `application_name=volcano_full_access`. Hyperdrive's origin
validation currently rejects this proxy's required startup parameter. The Worker
uses per-invocation Postgres.js connections through the service pool adapter, closes them before responding, and does not cache
SQL reads or API responses. No database migration or key rotation is required.

Use Node 24 and the repository's pinned pnpm. Authenticate Wrangler locally and
run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec wrangler deploy --config scripts/edge/api.wrangler.jsonc --var RELEASE_SHA:$(git rev-parse HEAD)
```

Runtime secrets are maintained in Cloudflare, preserved during deployment:
`PANAS_REGISTRY_DATABASE_URL`, `PANAS_PLATFORM_PRIVATE_KEY_BASE64`,
`PANAS_DESCRIPTOR_KEY_BASE64`, `PANAS_DISCOVERY_TOKEN_SHA256`, and the existing
public Solana devnet RPC/treasury-address settings. Never rotate signing or
descriptor keys as part of deployment: existing grants and encrypted descriptors
rely on them. No treasury private key is deployed. For initial setup use
`wrangler secret bulk` with a mode-600 JSON file in a private directory; never
place secret values in arguments, logs, source, CI descriptions or screenshots.

Cloudflare's enrollment rate-limit binding allows ten attempts per client IP per
minute at each Cloudflare location. Worker Cron performs metadata reconciliation
every ten minutes. The legacy Volcano deployment and GitHub maintenance workflows
are manual-only, preserving an explicit rollback path without deploying duplicate
API services on every main push. Deployments currently use the maintainer's local
Wrangler authentication; unattended CI requires a separate scoped deployment token.

Verify public listing responses have `x-panas-api-host: cloudflare-workers`, signed
buyer/provider operations remain valid, readiness heartbeats refresh and a fresh
`panas hello` returns an authoritative zero-charge receipt. Keep real two-host/NAT
acceptance separate from a buyer and Docker provider running on one physical Mac.

To roll back API routing, restore the two Cloudflare API routes to no Worker,
leaving `panas.mcpwire.co/*` on `panas-web-router`. That forwards API paths to the
existing Volcano origin again. Existing PostgreSQL data and keys stay intact.
Automatic enrollment will be unavailable on the old origin; never remove existing
sessions or fabricate success to hide that difference.

The edge adapter preserves bound parameters, transaction ownership and the existing
service result shape. It normalizes JSON objects and dates before binding and
preserves already serialized JSON strings. Both database integration suites run
against this adapter in CI. Unexpected failures log only an operation, error
class, SQLSTATE and query fingerprint; credential values and SQL parameters are
never logged.
