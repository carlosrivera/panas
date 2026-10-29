# Volcano outage/recovery (#10)

Implementation and focused component evidence only. An actual deployed Volcano outage, full CI, deployment, paid native-model drills and two-physical-Mac validation remain deferred for batch finalization. Existing client-only proxy observations do not complete the deployed-service outage gate.

## Behavior

Cloud availability is separate from native runtime/peer health. A failed registry publication, accounting descriptor upload or terminal batch blocks new provider admission without aborting an already-authorized active inference. Accepted queued work has not acquired execution authorization and receives durable failed terminal events without inference replay. Failed or ambiguous authorization responses never start generation. Authorization HTTP calls now have their own ten-second limit even while the longer execution signal is live.

The host retains its share for existing authenticated retrieval and active work while cloud calls fail. Owner pause/drain settings, signed authorization, startup binding and absolute execution deadlines still apply. The local pulse continues to detect actual process suspension; local heartbeats during a cloud outage are not remote lease renewals or cloud readiness evidence.

New publication first registers `testing`, uploads the private accounting descriptor, then registers the actual local availability state and confirms a heartbeat. Thus an accounting outage does not publish a newly starting provider as ready before descriptor acknowledgement. Admission remains blocked until the publication sequence and heartbeat are acknowledged. HTTP200 replies must bind the expected provider/startup/state, registration sequence/digest and an unexpired lease; malformed replies do not restore admission.

Publication attempts back off on the existing host pulse: 15, 30, then at most 60 seconds. Retries use fresh signed HTTP proofs. A final registration with an ambiguous reply retains the exact original body/sequence so the registry's idempotent retry path applies. Recovery rechecks accounting by re-uploading the same current descriptor before restoring admission. Already-issued HTTP requests cannot be retracted; both parties still enforce startup and request bindings.

A short outage can reuse a still-live registry lease and startup. An expired or uncertain lease is not revived by heartbeat. The host blocks admission and waits for active work to finish, then runs fresh capability tests and publishes a new startup/share. It does not rotate the startup under active inference to manufacture failure, replay, or settlement. Actual native/runtime failure, physical suspension or execution deadline can still terminate that work through their separate policies.

Terminal events remain signed and durable until an accounting acknowledgement and local acknowledgement write succeed. The host coalesces overlapping flushes, attempts at most 16 events per batch with a ten-second HTTP budget, and rotates the cursor between batches. A rejected/ambiguous event stays pending without starving later records. A response lost after cloud commit retries the same event, never inference; the cloud's existing transactional idempotency remains responsible for one settlement. A successful batch may leave additional records for subsequent pulses. No local HTTP response or fixture map substitutes for an actual receipt or ledger audit.

Buyer behavior remains fail-closed: unavailable discovery/quote/purchase calls cannot invent grants or receipts. An uncertain purchase retains its original request/idempotency key and hold; reconnect retrieves/reconciles that request. Existing focused buyer tests cover these rules without changing the buyer transaction protocol.

## Focused evidence

- Controller fixtures cover accounting outage before readiness, retry backoff, lost final registration reply, malformed heartbeat acknowledgement, active work across short/expired-lease registry outages, queued failure and fresh-startup recovery.
- Signed-host fixtures cover already-authorized completion during an outage, persisted terminal retry after service recreation, concurrent flush coalescing, lost committed acknowledgement and rotating batches past rejected records.
- A real loopback HTTP server stalls authorization: the client times out once within its own ten-second bound while the execution signal remains live. It does not contact Volcano or run a model.
- Existing buyer fixtures cover unavailable service responses, lost-purchase idempotency and reconnect without automatic inference replay. Sleep/wake, host shutdown and provider admission regressions are included in focused checks.

These are component fixtures, not a real cloud interruption, native-generation cancellation proof, real financial settlement, or two-host evidence.

## Deferred deployed-service drill

1. After the batch merges and full checks pass, record reviewed source/release identities and create isolated TEST_CREDIT fixtures. Use the pinned real model/MCPWire and buyer/provider on separate physical Macs.
2. Schedule a bounded maintenance window for the selected Volcano service with an independent recovery path and known prior release/configuration. Use the supported deployment/service controls reviewed at that time. Do not substitute a client-only proxy or deliberately break shared credentials/database state.
3. Interrupt the deployed registry service while native generation is demonstrably active. Observe discovery/purchase failures and lease expiry from the buyer; record if the small model completed first. Verify the provider does not replay generation or abort it solely because registry HTTP failed.
4. Restore the service. Require fresh startup/capability/probe/publication after lease expiry, preserved owner pause/drain, authenticated original-result retrieval, and one eventual receipt. Check old execution-grant startup rejection separately from retrieval of original work.
5. Separately interrupt deployed accounting before a new authorization: no inference may run without its acknowledgement. Repeat after authorization while native work is active: completion stays durable and terminal delivery remains pending. Restore accounting and verify the same event settles once, including an ambiguous-response case if safely observable.
6. Compare actual buyer/provider balances, held reservations, event/receipt identities, settlement counts and ledger invariants before/after. Keep uncertain outcomes pending under the audited reconciliation policy; do not release them merely to tidy the drill.
7. Restore all services to the reviewed configuration, verify readiness/maintenance and the live site, stop only owned fixtures, and retain redacted metadata. Keep raw tickets, grants, keys, prompts and outputs private.

Keep the actual deployed Volcano outage/recovery gate unchecked until these observations are recorded. The second physical Mac is a manual prerequisite; this agent cannot access it.
