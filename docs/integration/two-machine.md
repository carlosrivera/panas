# Manual second-Mac protocol

The agent cannot access the second Mac. These steps are a handoff for the owner, not an assertion that remote setup has happened. Do not use the local-simulation artifact to satisfy this gate.

## Prepare both physical hosts

1. On each Apple Silicon Mac, check out the same reviewed release commit, install Node.js 24 and pinned pnpm, and run `pnpm install --frozen-lockfile`.
2. Explicitly install the approved Ollama binary and small model. Verify Ollama version 0.40.12 and compare the local `/api/tags` digest with `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67` (the same pin in [setup.example.json](setup.example.json)). Model download is an explicit owner action, not a hidden launch step.
3. Generate a different Ed25519 provider key on each Mac, storing the private PEM mode 0600. Give only the public PEM and proposed provider ID to the test-project operator. Never move a private provider key or database credentials between machines for this demo.
4. The authorized operator enrolls each provider public key through the [registry enrollment CLI](../../packages/registry/scripts/enroll.ts), following the operator-only [registry guide](../registry.md). Operator database/platform secrets stay on the operator host. Each Mac needs only its own provider key, pinned platform public key, public service URLs, and its runtime/model paths.
5. Create a private provider environment per the [paid host README](../../apps/provider-mcp/README.md) and [native runtime setup](../../apps/provider/README.md). Use separate local application state. Both Macs may use the same loopback port on their separate computers. Launch the real controller with Node's environment-file loader:

```sh
node --env-file=/private/path/provider.env --import tsx apps/provider-mcp/src/host.ts
```

The controller must report fresh passing local checks and obtain its real startup-bound peer probe before ready publication. Its current probe is a separate local peer; it is not itself remote-NAT evidence.

## Establish remote buyer proof

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
- Observe active remote generation before testing an adapter disconnect or owned-provider crash. Record the actual winner if cancellation races completion; do not force the report to say cancelled.
- Sleep Mac B longer than the heartbeat TTL. Confirm ready-only discovery excludes it. Wake it, confirm a fresh capability suite/startup/probe, and execute another request without manually adding an MCP server.
- If forcibly killing a provider leaves an old Unix socket, stop/verify all owned processes before removing only that provider's stale private socket. Preserve its encryption key and durable requests. Record this operator recovery step explicitly rather than claiming automatic recovery.
- Retrieve the original request after reconnect/restart. Verify there is no automatic execution replay and the original receipt/debit is unchanged. Unknown work remains pending until the audited reconciliation path decides its outcome.
- Stop the remote controller on Mac B manually after testing; the buyer harness cannot remotely clean it up. Verify both provider runtime processes are gone and preserve the ledger audit.

Attach the reviewed metadata artifact and manual failure observations to issue #10. Keep its physical acceptance criteria pending until these steps really occurred. The harness deliberately never closes the issue automatically.
