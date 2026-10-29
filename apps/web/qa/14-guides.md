# Issue 14 — buyer and provider setup guides

The guides use shared server-rendered GuideLayout/GuideSection/CodeSample components and the landing design tokens. No browser credential form, copy-to-clipboard permission, or extra client bundle is needed. Code samples are selectable, keyboard-focusable horizontal scroll regions. The desktop table of contents becomes a normal top-of-page navigation on smaller screens.

## Source and command verification

Verified against merged source at the checkout baseline:

- Root package.json: Node >=24 <25, pnpm@12.16.1, frozen install supported.
- apps/buyer-mcp/README.md and src/config.ts: actual stdio entry point, all seven tools, exact owner configuration fields, HTTPS service URLs, owner-owned regular files mode0600, absolute paths. No invented installer or CLI flags.
- apps/buyer-mcp/src/service.ts and store.ts: encrypted private state, persisted dispatch, uncertainty/retrieval semantics, owner caps and gross charges including refunds. Cancellation alone is not a refund.
- apps/provider/src/config.ts and doctor.ts: exact runtime configuration variables, local capability checks with testing/unverified outcome, dedicated process cleanup.
- apps/provider/src/runtime.ts: explicit OLLAMA_MODELS, OLLAMA_HOST, OLLAMA_NO_CLOUD, one worker/model and bounded context. The temporary model setup example uses these same environment variables and must stop before Panas owns the port.
- apps/provider-mcp/package.json and src/host.ts: persistent controller command is `pnpm --filter @panas/provider-mcp run host`, not the disposable stdio adapter. All required host variables are shown; price version is optional in source but explicit in the template.
- Owning READMEs: operator-assisted enrollment/public-key configuration, private descriptors, startup-bound separate local-peer probe and signed heartbeats. No claim of two physical Macs or remote-network reachability.
- Official Ollama CLI/macOS/FAQ docs checked 2026-10-28: serve/pull syntax, macOS14+ requirements, OLLAMA_MODELS/OLLAMA_HOST/local-only configuration. The model download is explicit and directed to a dedicated temporary loopback runtime. No download or live model process was executed as part of this frontend QA.

All paths, identities, pins, service hostnames, sample caps and sample provider prices are clearly labeled templates. Owners must replace them; no real credential or executable secret is embedded. Maintained repository links may require repository access, which the guides state. Test credits are integer scale0; fixed request pricing is separate from diagnostic token counts. Provider workload visibility, non-attested reports, unavailable self-serve enrollment/real-money payment, cancellation/readiness recovery and safe uncertain-request retrieval are explicit.

## Verification and captures

Web typecheck, production webpack build, and root ESLint passed. Browser rendering on localhost3334 verified buyer/provider headings, seven actual tool rows, native disclosure controls, selectable code, and no page horizontal overflow at360/768/1440. Long code and the tools table scroll within their own regions. Automated accessibility/state coverage is the separate issue15 slice, not asserted here.

Captures outside Git at `/Users/carlos/code/panas/.panas/website-qa/14/`:

- buyer-desktop.png, buyer-mobile.png
- provider-mobile.png, provider-tablet.png, provider-desktop.png
- provider-mobile-top.png, provider-desktop-top.png

The final capture refresh includes the explicit dedicated-runtime model-download template. No live buyer or provider credentials were used.
