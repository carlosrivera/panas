# Final website QA and handoff (#15)

Final application source: d494553244ee18e9bffe28b10b51a0c59f7fcbd5. Subsequent QA documentation commits do not change application code. The user selected the actual erickrico PR27 design and explicitly deferred video. The final landing is the direct markup/CSS/shader port, not the superseded warm design or an approximate interpretation.

## Design and responsive verification

- Unmodified reference and actual port rendered in the same browser engine at1511x838,360x838,390x838,768x838. All26 measured element objects match exactly: nav, hero, headline, wire, dock, CTA, three windows, both section containers/inners/headings/tables, all8 table rows and footer. Objects include rectangles, typography, padding, gap and display. Document width equals viewport at each size.
- Actual markup/CSS, voice, original wire label, decorative titles and geometry are retained. Scoped CSS preserves functional content routes. Routing placeholders point to real destinations. Prototype/planned annotations sit in existing whitespace without moving original content. The original clip URL remains data-src while video is deferred; no substitute artwork or media-playback claim is made.
- All four main routes checked at360/768/1440, including shared shell, long guide code/table content, directory cards and footer. Full captures are saved for the final source. Model digest and maximum30-digit integer prices wrap at360px without page overflow.
- An effective720x500 viewport smoke (corresponding to200% of1440x1000) checked code and footer focus bounds above the persistent dock. This is viewport/reflow coverage, not a claim of real browser zoom or every assistive technology.

Evidence: `/Users/carlos/code/panas/.panas/website-qa/fidelity/` paired original/port captures and comparison.json; `/Users/carlos/code/panas/.panas/website-qa/15/final-*.png`.

## Accessibility and interaction

Axe-core4.14.0 ran WCAG2A/AA,2.1A/AA and best-practice tags on `/`, `/providers`, `/guides/buyer`, `/guides/provider` at360/768/1440: twelve combinations, zero detected violations. This is automated evidence, not a conformance certification. Incomplete contrast findings were supplemented with measured token pairs: primary text16.74:1, muted5.66:1, dim4.68:1 and lime15.74:1 on the original background; content-route muted text/card7.23:1.

Keyboard and DOM/accessibility-tree checks:

- Skip link is first Tab stop, visibly focused, Enter targets main and the next Tab continues inside content.
- Native role dialog opens from the original CTA, focuses seek, contains navigation to both actual guide URLs, and Escape closes and returns focus to the CTA. Root independently verified this with native IAB on production3333. Original decorative windows are aria-hidden.
- Guide code regions have explicit names/roles and keyboard scrolling. ArrowRight moved a focused code region119px; Tab exited to the next control. Native disclosure opened with Enter. Directory filters and pagination use native controls and labeled navigation; readiness has text labels plus a polite summary, independent of color.
- Reduced-motion emulation yields auto scrolling, no active CSS animations and a0s dialog transition. Original shader reduced-motion support is retained, but clip playback is deferred and was not exercised.

No VoiceOver/screen-reader session is claimed. Native OS tab-visibility/focus delivery was not established in the headless freshness fixture; the handler paths were exercised with explicitly synthetic events. These limits remain manual follow-up evidence rather than fabricated passes.

## Functional and freshness coverage

Eight focused web tests pass: exact45-second/report expiry, no false promotion, replayed/backward observedAt cannot renew a lease, integer scale0 formatting above Number precision, anonymous allowlisted proxy requests, private nested-field rejection, safe configuration/outage/not-found/invalid-filter handling and sanitized upstream400 cursor behavior. Web typecheck, root ESLint and production webpack builds pass; root also rebuilt the final source for3333. No shared Node ESM source conventions were changed.

Independent actual-browser/HTTP-fixture evidence at the unchanged lease logic checkpoint aaad066:

- Green readiness expired after44,808ms while eleven real fixture→BFF responses replayed the same frozen observation. Manual Refresh also stayed expired.
- Actual BFF503 outage and schema-invalid200 with a forbidden nested ticket field rendered status unknown, with zero green badges. The private sentinel did not reach public JSON/DOM.
- Synthetic focus and visibility events each cleared green while an upstream HTTP response was held, then recovered after valid data. A failed native tab-switch attempt is explicitly preserved as a limitation, not pass evidence.

This is fixture coverage, not live-provider or two-physical-Mac evidence. The visual port leaves that logic unchanged. Report and captures: `/Users/carlos/code/panas/.panas/website-qa/freshness/README.md` and report.json.

Additional isolated browser client-fetch fixtures verified next/previous opaque cursor transitions, max30-digit exact integer formatting, changed price/version/context/output/deadline/queue and model revision/digest after refresh, plus empty-registry rendering. These mocks cover the client UI; they do not claim BFF coverage or live inventory. No fixture fallback is shipped. Evidence: `/Users/carlos/code/panas/.panas/website-qa/15/directory-fixtures.json`.

Actual public-registry browser observations included three real records, expired→ready changes as independent controllers resumed, then stale/paused reports. Browser-forced outage downgraded retained data to unknown and recovered after interception was removed. Public browsing does not authorize or reserve work.

## Deployment and operational handoff

The frontend requires only nonsecret server-side `PUBLIC_REGISTRY_URL`. No discovery, operator, database, buyer, ticket or grant credential belongs in its environment or browser. Same-origin API reads use no-store, upstream8s and browser10s timeouts; malformed/missing/upstream failures show safe retry/reset states. Long-lived open pages retain expiry timers and visibility/focus revalidation. Supported UI filters are readiness and integer maximum price, with keyset pagination.

Build/dev intentionally use webpack with source `.js`→`.ts/.tsx/.js` aliases for shared Node ESM packages. Platform #9 deploys from a clean combined checkout; do not overwrite the serving3333 .next directory with an uncoordinated build. The web health endpoint reports the web process only.

Deployed acceptance evidence is recorded in deployed-http.json and axe-deployed.json under the local QA directory and summarized below once the active rollout passes. Video is explicitly deferred by the user; restoring the supplied asset src later activates the retained original renderer.

### Active deployment verified

URL: https://panas.mcpwire.co/

Combined release source759c14e8141ed04e4ef8d907f4d79cf5a2ce627e includes final application d494553. Platform lane confirmed active rollout and actual built assets before this frontend smoke. HTTP verification timestamp2026-10-29T05:28:21.469Z.

- Landing, directory, both guides and health returned200. Missing route and invalid provider slug returned404. Known provider detail and same-origin detail API returned200; unknown provider API404; invalid fractional filter400.
- Anonymous public proxy returned three strict-schema records with no-store and no forbidden private fields. Actual observations changed from two ready records in the HTTP sample to three expired records after the independent controllers stopped. This is real public freshness evidence, not a claim of two physical devices.
- A fresh cloud browser rendered all three actual cards, opened the original role dialog, focused the buyer guide link, exposed both real destinations, closed with native Escape and returned focus to the CTA. Zero browser errors were recorded in this clean deployed session. The hidden video has no src and no video resource request occurred.
- Axe at360/768/1440 on all four main routes again reported zero detected violations. Deployed captures and axe-deployed.json are in the QA artifact directory.
- Explicit browser-only client test doubles at the deployed URL simulated an API outage: all three retained cards became Status unknown. Try again recovered actual anonymous data. A simulated empty response showed No providers are listed yet; restoring actual fetch recovered three real cards. These are UI failure/empty tests, not service incidents or backend outage claims. All interception was removed and the test session closed.
- Maintained buyer/provider/host README targets were verified through authenticated repository reads; guides correctly state access may be required. Ollama references were verified against official docs; command/configuration verification is recorded in14-guides.md.

Deployed evidence: deployed-http.json, axe-deployed.json, deployed-client-states.json and deployed-*.png under `/Users/carlos/code/panas/.panas/website-qa/15/`. Independent read-only final-port browser findings are at `/Users/carlos/code/panas/.panas/website-qa/final-port-smoke.json`.

No deployment blocker remains for the non-video scope. Native OS event delivery, a full VoiceOver session, deferred media playback and physical two-device inference are explicitly not claimed. No browser checkout, account dashboard, provider control, real-money payment or automatic fan-out was added.
