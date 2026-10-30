# Provider crash recovery

Current serving uses the [Docker gateway and offline worker](../docker-sandbox.md). Recovery implementation, component fixtures and local container restart observations are distinct from a crash during accepted remote inference. The full paid Docker crash/two-physical-Mac gate remains open until recorded.

## Current Docker ownership and recovery

The Mac launcher owns the two containers and sends a heartbeat lease to the gateway. Lease loss or closed stdin terminates the gateway; owned-container cleanup stops the worker as the launcher exits. Never infer that a public provider is healthy from a surviving Docker process alone: current startup, capability, peer and registry evidence are required.

Persistent request, nonce and terminal-outbox state lives in the provider-specific gateway volume. On startup, the host claims that state before recovery and rejects a live predecessor. Owner metadata includes a container scope so PID reuse in a newly created gateway is not mistaken for the previous owner. A live owner in the same scope still blocks a second host. Untracked sockets, incomplete claims and malformed ownership require conservative owner review.

Retain the original provider key, encryption keys and Docker state volume. Interrupted `running` records become `unknown`; they are not automatically executed again or declared cancelled/completed to manufacture a refund. Durable completed results remain retrievable within retention, and pending signed terminal events retry idempotently. A new gateway launch obtains a fresh startup, capability suite and share ticket before readiness.

The offline worker owns Ollama's process group. The gateway uses authenticated Unix-socket runtime IPC; neither its runtime nor transport is a native host Ollama service. The owner-guard/process-group utility remains part of child supervision inside the relevant container.

## Evidence boundaries

[Docker validation](../validation/docker-sandbox.md) records actual local inference/cancellation and gateway recreation with retained-volume ownership recovery. A unit test covers live PID reuse across different container scopes. Those checks do not establish a remote crash while accepted generation was active or successful cloud settlement after that crash.

The earlier `apps/provider/src/crash-recovery.test.ts` subprocess fixtures use a fake native HTTP executable and fake CLI. They verify predecessor exclusion, owner-death group cleanup, stale-socket recovery, preservation of encrypted result/nonce/outbox bytes and conservative unknown-state handling. They are useful component checks, not native production serving instructions or current Docker end-to-end evidence.

## Deferred current-build live drill

1. Use isolated enrolled fixtures and record the exact CLI/image/source and deployed backend release. Start the Docker provider through `panas provider` with its owner environment, approved model, retained volume and selected free/test asset. A devnet-USDC case additionally requires the separately validated [funding flow](../payments.md).
2. Purchase once through the buyer facade. Observe actual worker generation before inducing the fault; a stored `running` flag or held completed response is not proof of ongoing computation.
3. Identify the exact owned launcher, gateway and worker privately. Test launcher loss and gateway loss as separate cases using only the corresponding owned PID/container. Do not signal a shared Docker daemon, unrelated runtime or cloud service. Record which containers actually stop and when leases expire.
4. Restart via the same CLI/environment, provider key and state volume. Require a fresh passing container/capability suite, startup/share and peer/registry publication. Never remove the volume to bypass an ownership or uncertainty error.
5. Retrieve the original request through fresh action authorization and the current descriptor. Verify its original request/startup binding, preserved durable result when available, unknown/pending handling otherwise, nonce protection and no automatic execution replay or duplicate debit.
6. Check terminal-outbox idempotency and authoritative receipt/ledger/hold invariants. Uncertain authorized work stays held until audited reconciliation decides its outcome. Stop only the owned fixture containers and retain metadata-only evidence.

Keep issue #10's physical crash acceptance gate pending until the matching observations exist. Older native artifacts remain evidence for their recorded build only.
