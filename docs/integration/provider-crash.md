# Provider crash recovery

The implementation and one-physical-Mac live drill have passed; two-physical-Mac observation remains pending. [October29 evidence](evidence/crash-and-boundaries-2026-10-29.json) records actual cloud authorization, pinned native inference, owner SIGKILL, preserved state and recovery. Component fixtures remain separate from this live evidence.

## Observed live run

The local observer changed only Ollama response framing to its supported [streaming API](https://docs.ollama.com/api/generate) for one armed request. The prompt/profile/output bound remained unchanged. A non-final native chunk at23:19:00.451Z triggered SIGKILL of the verified owned host at23:19:00.482Z. No completed response was held. All six captured descendants stopped and both owned runtime ports closed.

Restart with the original key/data passed fresh capability/peer checks and produced a new startup. Request/nonce encryption keys and the completed control record's encrypted bytes were preserved. The interrupted authorized request recovered as unknown/pending with no receipt or settlement; buyer replay was rejected. Original completed work remained retrievable with its same receipt and a fresh paid bounded request completed. A subsequent real startup-binding check rejected the old grant before nonce consumption, while refreshed original-request action authority retrieved unknown state.

The interrupted request initially held2 TEST_CREDIT pending separate operator review. After the real deadline and explicit human approval, the existing audited operator transaction released that reservation with a zero-debit failed receipt. Balance stayed994, held credits fell2→0 and settlement count stayed0. Audit `95b45418-eab5-42d2-982f-68875752e107` identifies that separate decision; it did not pretend the provider knew the interrupted outcome. Both fixtures now have zero holds, no overdue pending requests or financial invariant failures. The evidence records the earlier preflight ownership refusal and source/instrumentation attribution; this is not a claim of hardware attestation or two hosts.

Reproduce with a fresh private setup and verified release reference:

```sh
pnpm --filter @panas/integration run crash-seam --config /private/path/run.json
pnpm --filter @panas/integration run local-boundaries-seam --config /private/path/run.json
```

The commands use actual TEST_CREDIT purchases. Preserve private artifacts and review unknown reservations under the existing audited operator policy. They do not stop shared Volcano services or sleep the Mac.

## Implemented behavior

Both provider entry points claim the private data directory **before** opening request or nonce stores. A live recorded PID blocks a second host; PID reuse also blocks rather than risking another process. An atomic startup guard serializes dead-owner recovery. With a valid dead-owner record, the host probes and removes only a non-listening Unix socket; regular files, symlinks, live sockets and untracked stale sockets are refused.

The owner record remains through shutdown, so a successor cannot access the store merely because an early cleanup callback ran while its predecessor is still alive. The native runtime gets a short cleanup window on restart, but an occupied port is never adopted or signaled.

Native Ollama and external MCPWire CLI groups run beneath a small Node owner guard. The guard's private IPC channel closes when its parent dies, including SIGKILL. It terminates the owned group, reaps the native leader and kills remaining descendants. The CLI's stdio remains the transport stream; its bounded exit metadata travels on the separate guard channel. MCPWire remains an external pinned CLI.

Recovery uses the original provider key, request encryption key, nonce key and durable records. Interrupted `running` requests become `unknown`; they are never executed again automatically or declared cancelled/completed to manufacture a refund. Completed results within the existing retention window and pending terminal events remain available for authenticated retrieval and idempotent delivery. A new launch still runs capability tests and publishes a new startup and share ticket.

## Focused evidence in this batch

`apps/provider/src/crash-recovery.test.ts` uses real subprocess termination with a fake native HTTP executable and fake CLI. It verifies:

- a second owner is rejected before mutating a running record;
- killing the owner stops both detached groups, including SIGTERM-resistant fixture leaders;
- restart reclaims the stale socket and preserves encryption keys, completed encrypted result bytes, nonce bytes and a pending terminal record;
- interrupted state becomes unknown without fabricating a terminal result;
- a busy unrelated runtime listener survives a refused restart.

Existing runtime, host shutdown, signed-host service and MCPWire lifecycle fixtures cover the adjoining boundaries. These are component fixtures, not live cloud, real-model, or physical-host evidence. No new `provider-crash-e2e` passing artifact is asserted here.

## Repeat on the second physical Mac

1. Use fresh isolated TEST_CREDIT fixtures and record the reviewed source and deployed release. Launch the real pinned model and external MCPWire provider; observe passing launch tests and buyer discovery.
2. Purchase once through the buyer facade. Establish that native generation is actually active before the crash. A stored `running` flag or a held **completed** HTTP response does not establish mid-generation activity; report the observation accurately if the small model finishes too quickly.
3. Capture the exact owned host PID, startup and child groups privately. Kill only that provider host PID with SIGKILL. Do not kill another listener, a general Ollama service, the Mac, or shared Volcano services.
4. Confirm the owned runtime and transport groups stop, then restart with the same data directory, provider key, model and limits. Require a new passing capability suite, startup and share ticket.
5. Use a fresh authenticated retrieval through the buyer facade and current descriptor. Verify the original request/receipt binding, original completed result if one was durably recorded, unknown/pending handling for interrupted work, preserved nonce replay protection and no automatic inference replay or duplicate debit.
6. Check terminal-outbox idempotency and financial invariants. Unknown authorized work remains held pending the existing audited reconciliation/operator policy; do not release it simply to tidy the drill. Stop only owned fixture processes and retain redacted evidence.

Keep the corresponding #10 live-validation gate unchecked until this actually runs. Full two-Mac observation remains a separate manual gate.

## Conservative recovery cases

Upgrade an older host by stopping it normally first. Do not delete keys, request files or nonces to make startup succeed. A legacy stale socket without an owner record is not automatically trusted.

If the host was killed during the tiny startup-claim transaction, `host.starting` may remain. The next startup refuses it. An owner must verify that no startup/host is still running before removing only that empty guard and reviewing owner/socket metadata. Likewise, a reused live PID or malformed owner record requires manual review; never signal a PID merely because it appears in `host.owner.json`.
