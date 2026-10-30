# Live provider registry

The registry uses PostgreSQL for enrolled provider keys, immutable capability-report versions, current provider state, and replay nonces. API and MCP discovery use one `RegistryService` and the same readiness/filtering logic. Provider execution and paid accounting are separate components; the [buyer facade](../apps/buyer-mcp/README.md) combines them with registry discovery.

Providers publish free or asset-bound prices. Discovery accepts `currency`; a nonzero price filter without currency retains TEST_CREDIT semantics. Free providers can match any currency. Public listings show Free or an exact devnet-USDC amount; see [payment modes](payments.md).

## Provider protocol and trust

An operator enrolls an Ed25519 **public** key for each prototype provider. The registry never receives its private key. A signed report attributes claims to an enrolled provider; it is not hardware attestation or proof that inference occurred.

`POST /providers/register` accepts `{ report, price }` using `@panas/contracts/provider` and `@panas/contracts/registry`. A ready report requires all required local checks exactly once, Linux ARM64 gateway identity and Docker sandbox check (the launcher currently runs on Apple Silicon macOS), model/runtime revisions, a benchmark, and a dated verified separate-peer probe. A testing/unhealthy report may have missing model/benchmark metadata but cannot appear ready. Reports must be no older than five minutes at registration, with five seconds of tolerated clock skew.

`POST /providers/heartbeat` accepts `{ providerId, startupId, sequence, reportDigest, state }`. Use the digest returned by registration. Events have a per-startup monotonically increasing **safe integer** sequence. A duplicate identical heartbeat succeeds but does not extend liveness. Old startup IDs, changed duplicate payloads, replayed authentication, and lower sequences are rejected. A newer startup requires sequence zero and a newer test timestamp. New reports are stored before replacing the current view.

Each write supplies these headers:

- `X-Panas-Provider-Id`: enrolled UUID matching the signed JSON body.
- `X-Panas-Timestamp`: current Unix epoch milliseconds as a 13-digit string.
- `X-Panas-Nonce`: a fresh UUID for each HTTP attempt.
- `X-Panas-Signature`: Ed25519 signature encoded as base64url without padding.

Sign the UTF-8 string `panas-registry-v1\nPOST\n{path}\n{timestamp}\n{nonce}\n{sha256(exact_request_body)}`. Paths are exactly `/providers/register` or `/providers/heartbeat`. The exported `signProviderRequest` helper constructs this message. Signatures expire after two minutes. Retrying a semantic operation uses a new authentication nonce and the same sequence/payload; replaying the same signed attempt returns `REPLAYED_REQUEST`.

Enrollment is rechecked under a database lock before mutation, including the exact public key used during signature verification. A database trigger retires existing capability evidence whenever enrollment is revoked, reenabled, or its public key changes. Restoring eligibility requires capability tests dated strictly after retirement; advancing a report sequence alone cannot restore old evidence. This prevents concurrent revocation/key rotation from authorizing a mutation with a stale key. Each provider's updates serialize across function replicas.

## Readiness and safe discovery

Heartbeat defaults are 15 seconds between events and expiry at 45 seconds, evaluated on every read rather than by a cleanup worker. Capability evidence expires after 24 hours even with fresh heartbeats. Pausing or being busy changes availability without discarding valid capability evidence. An `unhealthy`, `offline`, or `testing` heartbeat retires evidence; a ready heartbeat cannot revive it until a fresh ready report is registered. Wake/new-startup tests are required by the provider lane.

Authenticated routes:

- `GET /providers`: `model`, `capability=text-inference`, `minContextTokens`, `minOutputTokens`, `maxPriceAtomic`, `maxLatencyMs`, `readyOnly` (default true), `limit` (1–50), `cursor`.
- `GET /providers/{providerId}`: current capability summary and explicit readiness reason.
- `POST /mcp`: official SDK Streamable HTTP, stateless JSON responses; `discover_providers` and `get_provider` tools.

Discovery requires a separate read-only bearer credential. The function stores only its SHA-256 digest in `PANAS_DISCOVERY_TOKEN_SHA256`; do not give buyer agents a Volcano service key or database credential. This is prototype credential authentication, not OAuth client registration. Rotate the discovery credential through project variables when access changes. Browser `Origin` requests are rejected; the informational frontend must consume an explicitly designed safe projection in its own issue.

Returned metadata excludes raw check details, memory/disk specifics, private peer tickets, public-key enrollment records, provider signatures, location, prompts, and buyer activity. Evidence is labeled `provider-reported`. Pagination sorts by provider UUID and excludes newly inserted rows after the first-page timestamp; cursors bind filters and expire after five minutes. Every page reevaluates current freshness, so expired providers disappear even mid-pagination. Listing is a live view, not a capacity reservation or immutable historical snapshot.

Provider bodies and MCP bodies are capped at 64 KiB. SQL parameters are bound, unknown input fields are rejected, errors use stable codes, and infrastructure errors do not disclose SQL/connection diagnostics. RLS is enabled without browser policies on internal registry tables; only the server's private database role can access them.

## Operator setup and deployment

Dedicated Panas cloud project: `7db5f8f4-c378-4ba5-a48f-f435bc4c034b`. Registry database: `registry` in `us-east-1`, PostgreSQL 17. Never deploy to another active CLI project accidentally. Existing informational frontend and private health function are preserved.

Use a private environment file (mode `0600`, outside the repository) containing `PANAS_REGISTRY_DATABASE_URL`. Keep TLS certificate verification enabled (`sslmode=verify-full`). Apply the idempotent single-statement migrations:

```sh
volcano use 7db5f8f4-c378-4ba5-a48f-f435bc4c034b
node --env-file=/private/path/registry.env --import tsx packages/registry/scripts/migrate.ts
node --env-file=/private/path/registry.env --import tsx packages/registry/scripts/enroll.ts \
  --provider-id PROVIDER_UUID --public-key-file /private/path/provider-public.pem
```

Use `panas_provider_keys.enabled=false` to revoke enrollment through an operator database connection. The enrollment script intentionally reenables/replaces the selected provider key, so run it only for an operator-authorized enrollment or rotation.

Set `PANAS_DISCOVERY_TOKEN_SHA256` alongside the database URL in the private deploy environment. Upload only those two project variables and scope them to `registry`; the frontend receives neither. The registry is a public Volcano HTTP-mode function with `http_auth_mode: none` so its application signatures/read credential reach the handler. This does **not** make discovery or writes unauthenticated.

```sh
volcano cloud variables deploy -f /private/path/registry-deploy.env
pnpm --filter @panas/registry run bundle
volcano cloud functions deploy -f registry
volcano cloud config deploy
```

The bundle includes shared contracts, registry logic, pg, and the MCP SDK. Generated `volcano/functions/registry/index.js`, its package manifest, and its isolated deployment lockfile are intentionally ignored by Git. The bundle step pins pnpm 12.16.1 and creates the dependency-free function lockfile with `--ignore-workspace`; the repository still has one committed workspace lockfile. The CLI packages them when explicitly deploying the built registry function; build before `volcano cloud deploy` as well. CI lints source and ignores this generated bundle. The handler uses ESM exports to match the generated package type, with a Node `createRequire` bridge for bundled CommonJS dependencies.

## Validation

`pnpm check` runs deterministic authentication, evidence, TTL, projection, filtering/cursor, error-redaction, and official MCP-client tests. Real PostgreSQL tests require an explicitly configured isolated database. The accounting-database CI job supplies PostgreSQL and runs the registry suite; ordinary local tests skip it without that environment:

```sh
# Supply PANAS_REGISTRY_TEST_DATABASE_URL from a private environment; do not paste it in commands/history.
pnpm exec vitest run packages/registry/src/postgres.test.ts --testTimeout 30000
```

These tests enroll ephemeral providers, exercise actual transactional races, replay/order checks, filters/expiry, revocation/key rotation, and evidence retirement, then remove only their own rows. Use an isolated development database. Cloud latency requires the 30-second test budget.

A client environment contains `PANAS_REGISTRY_URL` and the raw `PANAS_DISCOVERY_TOKEN`, never the database URL:

```sh
node --env-file=/private/path/registry-client.env --import tsx packages/registry/scripts/client.ts
```

`cloud-smoke.ts` additionally requires the private operator database URL to enroll an ephemeral **unverified/testing** fixture. It checks HTTP rejection, signed registration/heartbeat, and actual remote MCP initialize/list/discover/get, then removes its rows. It never advertises a fixture as a real ready Mac.

```sh
node --env-file=/private/path/registry-deploy.env --env-file=/private/path/registry-client.env \
  --import tsx packages/registry/scripts/cloud-smoke.ts
```

Cloud endpoint and invocation evidence are recorded in the registry PR after verification. An `active` status alone is not proof that an actual MCP request succeeds. These registry observations do not establish Docker hardware readiness, paid inference or the two-Mac product demo; those have separate [integration evidence](integration/README.md).

## Deployed verification

The test endpoint is `https://panas.mcpwire.co/registry/mcp`. A real official MCP client successfully initialized, listed tools, discovered providers, and fetched the ephemeral test provider. Signed HTTP registration and heartbeat succeeded, missing discovery credentials returned 401, and the unverified fixture was excluded from ready-only discovery. Fixture rows were removed afterward. This verifies registry protocol/storage behavior, not a real provider's hardware or the paid product flow.
