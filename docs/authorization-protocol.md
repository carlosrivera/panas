# Prototype authorization protocol v1

Shared implementation is `@panas/protocol`. It uses Node.js Ed25519 signing over a purpose-domain line plus canonical JSON. Canonical JSON sorts object keys by UTF-16 order, preserves array order, uses JSON escaping and finite numeric serialization, and rejects non-JSON values. Money stays integer strings. No private keys enter MCP tool arguments.

## Trust and binding

Platform public key is pinned in host/buyer owner configuration. Buyer keys are operator-enrolled for cloud budgets. Provider public key in a quote is taken from enabled registry enrollment, never from a model tool argument. Runtime grants bind buyer key, provider key, startup, quote, request, payload digest, model, limits, fixed amounts, and deadlines. Signatures attribute assertions; they do not attest hardware execution.

Domains: grant, buyer operation, provider response, provider terminal event, and cloud request are distinct. A valid signature is insufficient without schema validation, exact actor/target/operation/payload binding, fresh time window, and durable replay/idempotency decisions.

## Requests and results

The payload digest for inference is `digest({prompt,maxOutputTokens})`. Cloud quotes receive only this digest and bounds, not prompt content. Host arguments use `{proof,grant,payload}`. Construct proof first: its key identity and request metadata precede raw signature or inference content in normal CLI previews. This ordering is not an access-control boundary: managed MCPWire sessions must still discard raw upstream output and disable recording. The host and buyer never log full envelopes, tickets, or prompts.

`executeBefore` is a short execution-admission deadline. A grant's `expiresAt` bounds all authorized operations; do not accept an expired grant for retrieval. The authenticated accounting get-request endpoint can mint a fresh action-only grant permitting get/cancel on the original bound request/startup, without reserving more credit or renewing execution permission. Run always requires the current startup. Retrieval across restarts uses the existing durable request identity and pinned provider key.

Host responses contain `{body,proof}`; proof signs the body digest and binds provider/startup/request/operation and the buyer operation nonce. Buyer verifies the expected provider key and all bindings before presenting data.

## Accounting dependency

Only an authenticated, enabled provider can authorize execution against an active reservation. Buyer cancel is a request, not permission to release a running hold. A provider's durably stored terminal decision produces a signed metadata-only terminal event. The event is stored with the request and retried through a persistent outbox; a disposable peer adapter is not the delivery owner. The cloud transaction decides the single final outcome and balanced ledger entries. Unknown outcomes retain reservations pending a bounded reconciliation deadline and explicit operator decision; never replay inference automatically.

Private startup-bound connection descriptors are provider-uploaded and available only to authorized purchasing clients. They are excluded from discovery/listings and from buyer agent-visible tool output. The same grants authorize free requests, TEST_CREDIT fixtures and prepaid Solana devnet USDC. Currency and fixed amounts remain bound to the accepted grant; funding does not expand owner authority. Mainnet payments and automated on-chain payouts remain disabled. See [payments](payments.md).
