# Provider sleep/wake recovery (#10)

Implementation and component evidence only. Physical sleep, paid native-generation recovery, Postgres transaction validation, full CI and deployment remain deferred for batch finalization. This does not close #10.

## Recovery boundary

The host samples wall-clock progress every 15 seconds, including during launch tests and an in-flight controller operation. A gap of at least 45 seconds, an expired local heartbeat, or backward clock movement invalidates readiness synchronously at the next pulse or guarded operation. The daemon also checks execution boundaries, so a native completion or authorization callback that resumes before the timer cannot bypass recovery.

This is conservative liveness-gap detection, not a native macOS power-event listener. An event-loop stall or clock correction can also invalidate readiness. Sleeps below that threshold need not rotate startup; absolute execution deadlines and grant checks still apply. Tests use an injected clock and mocked runtime/transport, without sleeping this Mac or proving physical power-event behavior.

On interruption the host invalidates the report and peer proof, aborts active work, and stops its owned runtime. The controller pulse retires its MCPWire share even if a probe/publication is still awaiting I/O. Late callbacks cannot start another descriptor publication or heartbeat for that retired share. Already-issued HTTP requests cannot be retracted; old descriptors remain subject to the provider's readiness/startup checks. A controller recovery waits for share retirement before opening another one.

Accepted active work whose completion was not already decided becomes `failed / PROVIDER_SUSPENDED`. Accepted queued work becomes `failed / PROVIDER_UNAVAILABLE`; it is never replayed, including when the owner paused the queue. Existing terminal hooks persist zero-charge failure events for the normal outbox. A persistence failure remains uncertain, and later queued records stay recoverable rather than silently disappearing. Previously decided completed records and pending terminal events retain their original contents; a hard crash instead follows the separate unknown-state policy in [provider crash recovery](provider-crash.md).

Execution uses an absolute wall-clock deadline as well as its timer. A result delivered past its execution limit is rejected even if the timer callback has not run. A liveness interruption can take precedence and report `PROVIDER_SUSPENDED` when both conditions apply; neither outcome is a successful billable completion.

Recovery requires fresh local capability tests, a new startup, a new share, a separate-peer probe, and new registry/descriptor publication. Tests spanning an interruption are discarded. Owner pause/drain settings survive both wake recovery and routine descriptor rotation; publishing a new transport does not resume work. Clock rollback can require correcting the host clock before the cloud accepts newer signed evidence.

The registry rejects an advancing heartbeat or same-startup registration after its 45-second lease expires. Exact duplicate retries return the old record without extending its lease. This prevents a delayed heartbeat from resurrecting expired readiness; new startup evidence is required. Failed requests use existing fixed-price settlement/reconciliation rules; no balance or receipt is invented locally.

## Focused component checks

- `apps/provider/src/sleep-wake.test.ts`: completion-before-watchdog race, absolute deadline, delayed authorization, queued/paused work, persistence uncertainty, completed bytes/outbox, clock rollback, tests spanning a gap, responsive long tests, and fresh peer readiness.
- `apps/provider-mcp/src/controller.test.ts`: wake during probe, registry registration and descriptor upload; immediate share retirement; stale callback rejection; fresh startup publication; pause/drain preservation during descriptor rotation.
- `packages/registry/src/model.test.ts`: lease boundary. An additional opt-in Postgres regression checks the transaction path for expired heartbeat/registration and fresh startup recovery; it is deferred, not claimed as passing.

These fixtures do not demonstrate actual model cancellation, physical two-host connectivity, cloud settlement, or OS sleep notifications.

## Deferred manual drill

1. After the batch merges and full checks pass, record reviewed source/release identities. Use the pinned real model/MCPWire and isolated TEST_CREDIT fixtures, with the buyer on the other physical Mac.
2. Observe real native generation before sleeping the provider Mac for more than 45 seconds. Record the actual winner if the small model finishes first; holding a completed HTTP response is not active native generation.
3. From the awake buyer, confirm ready-only discovery excludes the expired provider and purchases fail closed. Preserve the request, grant/startup binding and reservation IDs privately.
4. Wake the provider. Require a fresh capability suite/startup/share/probe before new work, no automatic replay, and one terminal outcome for each accepted request. Verify old execution grants fail startup binding and authenticated retrieval still accesses previously durable results.
5. Inspect the real outbox, receipt/debit and ledger/held-reservation invariants. Verify a new bounded request succeeds through agent discovery. Unknown outcomes remain pending under the audited reconciliation policy.
6. Repeat with owner pause/drain, queued work, sleep during launch/probe, and a short sleep within the TTL. Record distinct observations and any blockers. Stop only owned fixtures and retain redacted evidence.

Keep the physical sleep/wake gate unchecked until this drill actually runs.
