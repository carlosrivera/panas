# Integration reproduction and evidence gates

Issue #10 remains open until the actual two-physical-Mac validation and outstanding end-to-end fault observations are satisfied. The #9 release gate is now backed by the final verified release and the real one-request smoke below. The second Mac exists but is inaccessible to this agent. Two provider processes on the available Mac are a **local simulation of the topology**, not two machines or two GPU resource pools.

## Modes

| Mode                 | Executes                                                                                                           | Evidence boundary                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `local-simulation`   | Two real provider/controller/Ollama processes on one Mac; real cloud registry/accounting; real MCP SDK and MCPWire | One physical Mac, two logical providers; physical gate remains pending                                           |
| `failure-fixtures`   | Existing owning-package failure tests with injected runtimes/clients/clocks                                        | Component fixtures; never relabeled as live cloud or hardware proof                                              |
| `manual-two-machine` | Buyer MCP calls both already running, distinct operator-attested physical hosts                                    | Requires human setup and truthful host declaration; script does not remotely install software or attest hardware |

All money is TEST_CREDIT. Do not configure production or real-payment endpoints. Operator setup creates fresh fixture provider/buyer IDs and keys; it must not modify a real buyer's policy or reuse another run's private directory.

## Local setup

Use Node.js 24 and the repository's pinned pnpm. Install from the committed lockfile. Have the explicitly installed Ollama 0.40.12 binary and `qwen2.5:0.5b` model available locally. The harness never downloads a model or adopts an existing runtime. Its ports are 11601 and 11602; it must not touch the normal provider port 11536 or the web preview.

Create a mode 0600 JSON owner file from [setup.example.json](setup.example.json). Its `privateDir` must be a new dedicated directory inside an ignored `.panas/` folder or outside the checkout. The operator environment is an owner-only file containing the test project's registry database URL, platform private key encoding, and descriptor encryption key; do not paste those values into the JSON, terminal arguments, logs, or GitHub issues. The pinned platform public key and discovery credential files must also be owner-only mode 0600 because the buyer's configuration reader enforces that policy.

```sh
pnpm install --frozen-lockfile
pnpm --filter @panas/integration run setup --config /private/path/setup.json
pnpm --filter @panas/integration run local-simulation --config /private/path/new-run/run.json
pnpm --filter @panas/integration run failure-fixtures --output /private/path/new-run/fixture-evidence
```

`setup` enrolls two new provider public keys and one new test-credit buyer/session through authorized operator access. It writes separate private keys, runtime ports, daemon data paths, provider environments, and buyer state. It issues only test credit. Use a new private directory for another setup; never overwrite an earlier run's keys or durable state.

The local runner waits for both providers' actual launch tests and separate-process peer probes to pass before discovery. It filters the run's own providers, checks the advertised model/profile/readiness, and selects the lower listed provider price. It purchases and executes, closes/recreates the buyer adapter, verifies the same fixed receipt after retrieval, rejects duplicate execution, races two independently stored buyer processes against one cloud-authoritative balance/session cap, pauses one provider and selects the other, and observes heartbeat expiry after stopping the first.

The model is fast: closing an adapter after dispatch does not prove the model was still generating at disconnect. Evidence records that distinction. Hard deadline, controlled mid-generation cancellation, runtime faults, and unavailable cloud clients are covered by separately labeled fixture checks unless a specific actual fault-injection observation is recorded.

The runner also routes only its own accounting clients through an isolated HTTPS forwarding proxy with an ephemeral local CA. `NODE_EXTRA_CA_CERTS` is set only for those child processes; TLS verification is never disabled globally. Controlled 503 tests establish failed-new-purchase behavior and durable terminal-outbox recovery against the actual cloud service without stopping or reconfiguring shared Volcano services. These cases use the distinct `fault_injected_cloud_one_mac` source label. They are not an actual deployed-service outage.

## Cleanup and retained state

The runner stops only provider processes it launched and checks its two dedicated runtime ports are closed. It preserves encrypted request/receipt state and private configuration for inspection. The public website remains running. Fixture cloud enrollments and append-only test-credit ledgers remain as audit evidence; stopped providers disappear from ready discovery by TTL. Do not delete ledger rows to tidy up a demo.

If the process is forcibly terminated before its cleanup runs, use its private run configuration to identify the two owned processes and stop those controllers. Do not kill arbitrary listeners or a shared Ollama service. A false cleanup flag blocks a passing report and requires operator investigation.

## Report privacy and release gate

Each run writes a strict metadata-only evidence JSON file in its private run directory. It contains run/commit/timestamps, case status, request/receipt IDs, cleanup results, and explicit physical/release gates. Raw grants, tickets, prompts, outputs, private keys, database URLs, and child diagnostics are excluded from this shared report. Raw child diagnostics are retained separately in bounded mode 0600 logs inside the private run directory for debugging; never copy those logs into a public artifact. Review the generated file before copying it into a review artifact.

An optional `releaseEvidencePath` points to #9's actual verified `artifacts/release.json`. The harness validates the exact Panas test project ID, committed release identity, tracked migration counts, mandatory named checks, and exact registry/accounting service URLs in the referenced report. It does not independently re-probe those endpoints; the gate label is `referenced_verified_report`, attributed to #9's report producer. Endpoint success alone does not complete #9. No supplied proof means `release9: pending`; malformed or mismatched proof means `referenced_unverified`.

`issue10Complete` stays false in generated reports. Completion is a reviewed decision after the physical checklist and failure matrix are satisfied; the harness cannot close the issue automatically.

Continue with [the two-machine protocol](two-machine.md) and [the failure matrix](failure-matrix.md).

## Evidence captured so far

[The clean-source local report](evidence/local-simulation-2026-10-28.json) records ten passing actual cloud/one-Mac or explicitly injected-transport observations, one pending physical gate, and seven end-to-end fault scenarios not run. It identifies tested commit `8bcc2c1a35d6ff5642f007269fd930caa5ea48cf` and `sourceTreeDirty: false`. [The separate fixture report](evidence/component-fixtures-2026-10-28.json) records component checks with their exact passing test names; it does not fill the missing end-to-end scenarios.

Later PR commits add independently tested report-parser refinements and a release smoke mode. Migration `applied`/`adopted` counts are per deployment while `total` is cumulative, so an idempotent replay with0/0/37 is valid. The original tested source identity remains unchanged in its artifact.

After #9 produces its actual final full-release report, set `releaseEvidencePath` in the private run config to that report and run one final paid request without repeating the entire failure sequence:

```sh
pnpm --filter @panas/integration run release-smoke --config /private/path/new-run/run.json
```

This mode refuses to launch or purchase if the release reference is absent or invalid. It runs the actual provider startup/discovery/quote/purchase/inference/receipt and reconnect checks, performs only one new paid request, and records the referenced release commit separately from the harness commit. The hardware gate remains pending.

[The final release smoke](evidence/release-smoke-2026-10-29.json) passed on clean harness commit `22e33941a0b9931147bfd474a8159b7bb624fe51` against verified Volcano release `759c14e8141ed04e4ef8d907f4d79cf5a2ce627e`. In 42.98 seconds, two real provider processes on one physical Mac published startup-tested readiness; the buyer selected the intended lower fixed price, completed exactly one new paid request through MCPWire and the pinned model, then retrieved the same receipt after adapter replacement and duplicate attempts. The receipt balanced 1 buyer debit / 1 provider earnings / 0 fee in atomic TEST_CREDIT units, with 6 input tokens, 16 output tokens, and actual finish reason `length`. Both owned inference processes stopped and both dedicated runtime ports closed. The referenced full-release report passed all seven named checks; `release9` is `referenced_verified_report`. Physical two-Mac evidence and the seven explicit end-to-end fault drills remain pending; `issue10Complete` stays false.

## Actual authorization and queue fault seams

Create a fresh isolated setup directory/buyer (existing held requests are rejected), then run:

```sh
pnpm --filter @panas/integration run fault-seams --config /private/path/new-run/run.json
```

This mode uses a raw owner-controlled MCPWire peer because the normal buyer facade deliberately prevents sending malformed authorization. It purchases real cloud grants and checks copied-ticket/no-entitlement rejection, altered grant/payload/buyer identity, actual short-proof expiry, exact signed-nonce replay, and natural cloud `executeBefore` expiry using a fresh proof after the real deadline. Invalid authorization must leave no fabricated provider request/terminal state or settlement; the original legitimate request is executed once and kept retrievable.

The queue seam briefly sends SIGSTOP only to the actual Ollama listener after verifying its dedicated port, exact command and ancestry under the controller this runner launched. A three-second independent SIGCONT watchdog, finally cleanup and signal cleanup prevent an assertion failure leaving it stopped. Four pre-purchased requests fill one active/two queued slots and require a genuine QUEUE_FULL rejection for the fourth. That decline must create a durable failed zero-charge cloud receipt. The other requests are explicitly cancelled and require durable cancelled zero-charge receipts. This is process-level injection on this Mac, not physical sleep or two-Mac evidence.

The natural execution-expiry request deliberately retains its reservation: an unexecuted request has no provider terminal decision, so missing local state must not be relabeled cancelled. Keep its request ID for bounded reconciliation and the existing audited operator resolution path after the real reconciliation deadline. The harness never silently releases, refunds, deletes a ledger row or alters the clock. Controlled early/late cancellation observations do not claim a simultaneous cancellation/completion race. Actual crash, deadline, physical sleep/wake and service outage remain separate gates unless later artifacts establish them.
