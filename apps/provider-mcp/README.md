# Paid provider host

`@panas/provider-mcp` has two entry points. `host` is a persistent local controller; `start` is a disposable stdio MCP adapter launched by MCPWire. The controller owns authentication, durable replay state, inference, and terminal-event delivery. A peer disconnect only removes its adapter process.

## Owner setup

Use the explicit Ollama/model setup described in `../provider/README.md`. The provider ID and Ed25519 key must be enrolled by the control-plane operator before signed registration or accounting requests will succeed. Cloud buyer enrollment and test credits are owned by accounting. No real money is enabled.

Additional owner configuration:

```sh
export PANAS_PROVIDER_PRIVATE_KEY_PATH='/absolute/path/to/private-ed25519.pem'
export PANAS_PLATFORM_PUBLIC_KEY_PATH='/absolute/path/to/pinned-platform-public.pem'
export PANAS_REGISTRY_URL='https://registry-service.example'
export PANAS_ACCOUNTING_URL='https://accounting-service.example'
export PANAS_PRICE_VERSION='1'
export PANAS_PRICE_ATOMIC='10'
pnpm --filter @panas/provider-mcp run host
```

Private key files must be mode0600 or more restrictive. Keep keys and runtime state outside version control. Platform and provider key identities are owner configuration, never model-controlled input. The private directory/socket/token are shared only with trusted local adapters belonging to the provider OS account.

On a passing local launch, the controller starts the pinned external MCPWire CLI, probes `get_capabilities` through a separate join process, binds evidence to the tested startup, signs provider registration, uploads the private startup-bound ticket descriptor to accounting, and sends signed heartbeats. The current probe establishes a separate local-peer round trip; it does not prove remote NAT reachability. Failed publication or probe invalidates readiness. Registry TTLs expire an unavailable provider. The controller rotates its one-hour share before the 55-minute private descriptor expiry and drains accepted work before retesting.

Raw MCPWire stdout/stderr previews are not forwarded or logged by the managed transport, and recording is disabled. Do not run the adapter through an unmanaged share command that records/logs envelopes. Encrypted transport protects the network path; it does not conceal the provider's own workload from that OS account.

## MCP surface

Only four tools exist:

- `get_capabilities`: public current report with top-level `startupId`; no private connection descriptor.
- `run_inference`: validate a signed platform grant, fresh signed buyer operation, payload digest, model/startup/profile binding, and durable nonce before local admission. The persistent worker additionally calls live accounting authorization against an active reserved request immediately before generation.
- `get_request`: a fresh authorized action on the original durable request. Refreshed action-only grants allow retrieval after execution-grant expiry and across daemon restarts with the same provider key. An old startup never permits a new run.
- `cancel_request`: produces the provider's durable cancellation decision; it does not directly release a cloud reservation.

Arguments use shared `@panas/protocol` `{proof,grant,payload}`. Inference payload is `{prompt,maxOutputTokens}`; action payload is `{}`. Signed responses are `{body,proof}`. Body contains only request status/result/error/time, excluding grants, internal buyer IDs, local paths, and connection material. Response proof binds provider, original startup, request, operation, buyer nonce, result digest, and issuance time. No MCP resources, prompts, filesystem, shell, or runtime-management tools are registered.

The same operation nonce cannot be consumed twice, including after restart. Reconnect uses a fresh signed `get_request` operation rather than replaying uncertain inference. The provider daemon keeps one device-wide worker independent of the number of peer adapters.

## Durable settlement boundary

A terminal decision and its signed metadata-only terminal event are written together in the encrypted request record. The persistent controller retries undelivered events through an outbox; adapter loss cannot remove the event. Completion/failed/cancelled records provide the cloud's single terminal outcome, while recovered unknown records retain uncertainty for reconciliation. A transient cloud outage retains the event locally.

Accounting authorizes the exact reservation before execution. A cloud cancel request cannot independently release an already authorized hold. The terminal outbox—not the buyer's cancellation request—is the settlement input. Terminal persistence failures fail closed: results are exposed as unknown, the worker is invalidated/stopped, and uncertain events are withheld until restart/reconciliation establishes durable state. Cloud delivery acknowledgments are persisted; retries use the same event ID.

## Validation boundaries

Tests cover Ed25519 identity/payload/startup/expiry/operation/limit binding, durable replay rejection, current-reservation authorization, signed result verification, cross-restart authenticated retrieval, persistent terminal-event retry, and cancellation decisions. An actual SDK stdio client test kills/recreates the disposable adapter, retrieves the existing request, and checks resource/prompt bypass rejection. These injectable-runtime/accounting tests are not a claim that the complete Volcano/accounting deployment has been exercised.

Run `pnpm check` and `pnpm format:check` from the repository root. Complete end-to-end evidence must use the real accounting service and real MCPWire handoff; fixture endpoints do not satisfy that integration gate.

### Verified transport hop

On October 28, 2026, `PANAS_RUN_P2P_TESTS=1 pnpm exec vitest run apps/provider-mcp/src/service.test.ts` passed the separate-process MCPWire share/probe/join test. It verified the startup, signed run response, and rejection of deliberately malformed private-sentinel arguments while managed transport events exposed neither argument previews, prompts, nor the ticket. This exercised the real external MCPWire CLI with injectable inference/accounting, not the full paid cloud transaction.
