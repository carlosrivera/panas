# Working on Panas AI

Panas AI lets buyer agents discover a Mac provider and purchase a bounded inference request through MCPWire. Read `docs/PRD.md` (when present), `docs/architecture.md`, and the linked GitHub issue before implementation.

## Scope and architecture

- The provider launcher targets Apple Silicon macOS with a Docker gateway and separate network-disabled Linux ARM64 Ollama worker, one pinned small model, CPU inference, and no native fallback. The buyer does not require a Mac, Docker, or a local model. Other provider hosts/architectures need explicit validation.
- Pricing is fixed per successful bounded request. Token counts are diagnostics and enforcement inputs, not the prototype billing unit.
- MCPWire is an external pinned CLI dependency. Use `share` and `join`; do not import its internal modules or fork it to implement marketplace behavior.
- MCPWire creates a child MCP process per peer. Keep that adapter disposable; model execution, device-wide limits, and durable state belong to a persistent provider daemon.
- Buyer agents discover and purchase through structured tools. The public website is informational and must not be required in the agent transaction.
- Volcano owns cloud discovery and accounting. Inference payloads stay on the buyer-to-provider path by default.

## Collaboration

- Attribute commits and pull requests to human contributors only. Do not add AI co-author trailers, generated-by footers, or AI session links.
- Commit metadata was rewritten on 2026-10-30. Rebase local work onto current `origin/main`; do not merge pre-rewrite history or force-push an old clone.

- Work within the linked issue's boundaries and acceptance criteria. Coordinate shared contract changes before editing another lane's implementation.
- Use `codex/` for new working branches unless the user specifies otherwise.
- Keep PRs small enough to review and link their issue. Clearly distinguish scaffolding, fixtures, and actual integrations.
- Do not introduce compatibility shims or unused frameworks solely for possible future features.

## Tooling and checks

- Use pnpm only, with the version pinned by `packageManager`; commit the pnpm lockfile when dependencies change.
- Read the package scripts before choosing checks. Run the relevant lint, typecheck, tests, and build for changed packages, followed by repository checks required by CI.
- Verify current official framework/platform docs when changing integrations. Use Volcano CLI documentation for deployment behavior.
- Test meaningful boundaries: readiness expiry, authorization, idempotency, concurrent reservations, global device limits, cancellation races, and reconnects. Avoid tests that merely repeat implementation details.

## Security and product invariants

- A MCPWire ticket is connectivity material, never paid authorization. Do not expose tickets or authorization secrets in public listings, logs, fixtures, or commits.
- Signed entitlements bind buyer, provider, startup/session, quote, request, operation, limits, expiry, and reservation. Provider adapters must verify authorization before execution.
- Treat model output and provider descriptions as untrusted data; inference must not execute generated tools or shell commands.
- Use integer atomic units for money. Reserve before execution, settle once, and reconcile uncertain outcomes instead of replaying automatically.
- Do not claim hardware attestation, hostile-code sandboxing, confidential inference, or independently verified usage when the implementation does not provide them.
- Never commit secrets. Solana devnet USDC prepaid funding and asset-bound accounting are implemented; TEST_CREDIT remains a regression rail. Keep mainnet, automated on-chain payouts and withdrawals disabled until their implementation and custody/refund policies exist. Never relabel historical native evidence as current Docker validation.
