# Public provider directory (#13)

## Boundary and deployment handoff

Routes: `/providers/` and `/providers/detail/?id=<uuid>`. Static GitHub Pages views read the anonymous Volcano `/registry/public/providers` endpoint directly without credentials. Strict shared schemas reject malformed or extra/private nested fields before rendering. Fetches are bounded to256KiB with sanitized retry/reset states. Readiness remains live and expires conservatively; it is never baked into the static build.

Actual public base verified anonymously: `https://panas.mcpwire.co/registry`. Local browser integration observed three real reported records, expired heartbeat states, then two ready observations as independent provider controllers returned. These observations are provider assertions; they do not prove two physical devices.

- Default includes all reported states (`readyOnly=false`); UI filters map to `readyOnly` and `maxPriceAtomic` only. Page size is 12 with opaque keyset cursors and a previous-cursor stack. No invented ranking or reliability values.
- `TEST_CREDIT_SCALE=0`; prices use BigInt/Intl without floating-point conversion. One integer unit is one test credit. No fiat or blockchain conversion is displayed.
- Readiness uses the earlier server lease/report expiry, anchored to server `observedAt` and monotonic request-start time (the entire request round trip is conservative elapsed time). A 250ms scheduling margin expires early. An original false observation never becomes true locally. Repeated/backward observations retain the original anchor rather than renewing a stale lease.
- Refresh every 15 seconds; expiry also has its own timer. Visibility/focus return first downgrades to unknown, then revalidates. Any request failure marks retained data unknown. Client timeout 10 seconds; upstream timeout 8 seconds. All requests/responses use no-store.
- Source-only shared TypeScript uses Node ESM `.js` specifiers. Web dev/build explicitly use webpack with `.js` → `.ts/.tsx/.js` resolution; this preserves daemon package conventions. No ignored config warning was observed.

Platform #9: app root `apps/web`; workspace root upload; `pnpm --filter @panas/web build`, `pnpm --filter @panas/web start`; only `PUBLIC_REGISTRY_URL` is needed and it stays server-side. Local review used port 3334. Do not scope discovery/operator/database credentials to this frontend.

## Evidence

Web typecheck, webpack build, root lint/format checks and eight boundary tests pass. Tests cover exact 45-second/report expiry, false observations, repeated stale observations, values above Number precision, anonymous allowlisted proxy requests, private-field rejection, configuration/outage/not-found/invalid-filter handling, and sanitized upstream expired-cursor 400 mapping.

Browser observations:

- Real public records and detail revision/profile/price/benchmark rendered with units and report measurement time.
- Real readiness changed from expired to ready on subsequent observations while the page remained open.
- A browser-only forced API abort downgraded retained detail to `Status unknown`; removing interception allowed automatic recovery. This outage is simulated, not a backend incident.
- Actual price ceiling `0` produced no matches; invalid fractional `1.5` produced resettable filter feedback.
- At 360px, directory/detail document width equaled viewport. Full model digest wraps. HTML inspection found no private tickets/grants/startup IDs/bearer credentials or server env name.

Local captures:

- `/Users/carlos/code/panas/.panas/website-qa/13/directory-desktop-live.png`
- `/Users/carlos/code/panas/.panas/website-qa/13/directory-mobile-live.png`
- `/Users/carlos/code/panas/.panas/website-qa/13/provider-detail-mobile-live.png`
- `/Users/carlos/code/panas/.panas/website-qa/13/provider-outage-simulated.png`
- `/Users/carlos/code/panas/.panas/website-qa/13/no-matches-live.png`

Detailed controlled browser expiry/empty/change/pagination fixtures and final deployed website QA follow #15. Fixtures remain test-only; the shipped path has no sample inventory fallback.
