# Manual second-Mac protocol

The agent cannot access the second Mac. These steps are a handoff for the owner, not an assertion that remote setup has happened. Do not use the local-simulation artifact to satisfy this gate.

## Prepare both physical hosts

1. On each provider Mac, use Apple Silicon macOS 14+, Docker Desktop, Node.js 24, and the same reviewed CLI release with its matching Linux ARM64 image. Use [distribution setup](../distribution.md); source builds use `./docker/build.sh`. A buyer may run on a separate supported macOS/Linux computer without Docker or a local model.
2. Explicitly install or copy the approved `qwen2.5:0.5b` model cache. The launcher verifies manifest/blob hashes against digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67` and stages it read-only. The matching image supplies Ollama 0.40.12; host Ollama is not used for serving and no model download happens during launch.
3. Generate a different provider identity on each Mac using `panas identity init`. Give only the public key and provider ID to the operator. Each provider keeps its own private key; operator database/platform secrets never move to the provider.
4. The operator enrolls both provider public keys using the [registry enrollment procedure](../registry.md). Prepare separate owner-only provider environments using the release example, public service URLs and trusted pinned platform public key.
5. Launch each provider through the Docker CLI with the appropriate private environment:

```sh
~/.local/bin/panas provider --free --env-file /private/path/provider.env
```

For a paid drill, configure both providers and a separately enrolled buyer for Solana devnet USDC; use `--solana-devnet --price-atomic 10000` instead of `--free` and follow [payments](../payments.md). The existing `manual-two-machine` harness below is a TEST_CREDIT regression harness; do not treat it as Solana funding validation. For that harness, use explicitly configured TEST_CREDIT provider prices and its matching buyer instead.

The controller must pass container/capability checks and its startup-bound peer probe before readiness publication. Its local probe does not establish remote-NAT reachability. There are no published host runtime ports; preserve the provider-specific Docker state volume across restart.

## Establish remote buyer proof

For the current free/devnet demo, configure the enrolled buyer via [distribution](../distribution.md), then use `panas demo-prompt` or `panas demo-prompt --paid` and record a real request/receipt on each physical provider. A devnet drill additionally requires an actual finalized funding transfer and matching asset-bound receipt. The TEST_CREDIT harness below remains a separate regression option and its compatibility with the selected Docker build must be verified, not assumed.

The operator enrolls a test-credit buyer/session and supplies a mode 0600 buyer configuration following the [buyer setup guide](../../apps/buyer-mcp/README.md), with owner limits, public service URLs, discovery credential path, private buyer key path, pinned platform key path, and a fresh buyer state directory. Do not paste connection tickets or signed grants into a chat or issue.

On the buyer host, create a manual configuration using the schema below. The host aliases are operator declarations; the harness cannot independently attest physical hardware. The operator must actually verify that the two provider IDs belong to the two separate physical Macs before supplying the attestation.

```json
{
    "version": 1,
    "mode": "manual-two-machine",
    "physicalMachineCount": 2,
    "privateDir": "/private/path/manual-evidence",
    "registryUrl": "https://cdb5c197-93ad-4c13-8dca-45e1d18140f5.functions.volcano.run",
    "accountingUrl": "https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run",
    "buyerConfigPath": "/private/path/buyer.json",
    "physicalHosts": [
        { "alias": "mac-a", "providerId": "OWNER-SUPPLIED-FIRST-UUID" },
        { "alias": "mac-b", "providerId": "OWNER-SUPPLIED-SECOND-UUID" }
    ],
    "operatorAttestation": "OWNER WRITES A TRUTHFUL STATEMENT AFTER VERIFYING BOTH PHYSICAL MACS",
    "releaseEvidencePath": "/private/path/verified-release.json"
}
```

Replace the placeholders; the two provider IDs and aliases must differ. Then run:

```sh
pnpm --filter @panas/integration run manual-two-machine --config /private/path/manual.json
```

The buyer discovers both and executes a separate request on each, verifying result signatures and balanced receipts through the real facade. A successful result is operator-attested two-host evidence, not hardware attestation. Run the buyer on Mac A or a separate machine so at least the Mac B request crosses physical hosts; a successful local-only peer probe does not substitute for this request path.

## Manual fault and evidence checklist

- Record the reviewed source commit and #9 release proof, host aliases, provider IDs/startups, model/runtime revisions, and run timestamps. Exclude serial numbers, private IPs, credentials, raw tickets, grants, prompts, and model output from the shared report.
- Complete the [startup-binding, natural 24-hour action expiry and rate-cap protocol](authorization-boundaries.md) after batch finalization. Exact clock-boundary fixtures support implementation; they do not certify those live observations.
- Follow the [Volcano outage/recovery protocol](volcano-outage.md) for actual deployed registry/accounting interruptions, active work, terminal retry and ledger checks. These service drills remain deferred; client-only transport faults do not complete them.
- Observe active remote generation before testing an adapter disconnect or owned-provider crash. Record the actual winner if cancellation races completion; do not force the report to say cancelled.
- Sleep Mac B longer than the heartbeat TTL. Confirm ready-only discovery excludes it. Wake it, confirm a fresh capability suite/startup/probe, and execute another request without manually adding an MCP server. Follow the [sleep/wake recovery drill](provider-sleep-wake.md), including accepted work, old startup grants, paused/queued work and outbox/receipt checks; these physical observations remain deferred.
- Restart the current host with its original private state and provider key; its container-scoped owner claim validates prior ownership and stale socket state before recovery. Legacy/untracked sockets and incomplete startup claims require explicit owner review. Follow [provider crash recovery](provider-crash.md); preserve encryption keys, requests, nonces and the terminal outbox.
- Retrieve the original request after reconnect/restart. Verify there is no automatic execution replay and the original receipt/debit is unchanged. Unknown work remains pending until the audited reconciliation path decides its outcome.
- Stop the remote controller on Mac B manually after testing; the buyer harness cannot remotely clean it up. Verify the owned gateway/worker containers are stopped and preserve the ledger audit.

Attach the reviewed metadata artifact and manual failure observations to issue #10. Keep its physical acceptance criteria pending until these steps really occurred. The harness deliberately never closes the issue automatically.
