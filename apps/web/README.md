# Panas web

Informational Next.js App Router frontend: the user-selected PR27 landing, real public provider directory/details, and buyer/provider setup guides. Browsing never reserves capacity or authorizes a purchase. Agent discovery and purchase use the independent local MCP facade.

From the workspace root, with Node24 and pinned pnpm:

```sh
pnpm install --frozen-lockfile
pnpm --filter @panas/web dev
pnpm --filter @panas/web typecheck
pnpm --filter @panas/web build
python3 -m http.server 3333 --directory apps/web/out
```

Dev and the static preview use port3333. Use a separate checkout when serving production and rebuilding/developing concurrently; coordinate preview restarts to avoid stale chunks. Dev/build explicitly use webpack to resolve shared Node ESM `.js` source imports to their TypeScript files without changing daemon conventions.

The app exports static HTML/CSS/JS into `out/`. GitHub Actions (`pages.yml`) builds and publishes it to GitHub Pages. Cloudflare serves it at **https://panas.mcpwire.co/** through the `panas-web-router` Worker; `/registry` and `/accounting` continue to use the existing Volcano origin and unchanged public URLs. The Pages artifact uses a root base path because the public hostname is the root of the site; its project URL is an origin, not the public entry point.

`NEXT_PUBLIC_REGISTRY_URL` is a nonsecret public read base, defaulting to `https://panas.mcpwire.co/registry`. Browser reads append `/public/providers`, omit credentials, enforce strict public schemas and a 256KiB response limit, use an8s deadline, refresh every15s and preserve conservative heartbeat/report expiry. No discovery/operator/database/buyer credentials belong in this app or browser. Provider details use `/providers/detail/?id=<uuid>` so new providers work without rebuilding the site. No request-time Next.js server or `/api/*` routes are needed.

`NEXT_PUBLIC_SITE_URL` defaults to `https://panas.mcpwire.co`; `NEXT_PUBLIC_BASE_PATH` defaults to an empty string. They are build-time values.

Shared styles/primitives live in `@panas/ui`. The original landing CSS is scoped in app/pr27.css. The original handshake clip is served from `public/video.mp4` and connected to the landing canvas animation via `/video.mp4`. This short visual asset is separate from the product demonstration recording. Original shader/hover/focus/reduced-motion code remains; no substitute artwork or external font service is used.

The homepage combines accessible free/paid tabs with live provider cards. The directory preserves the chip/card design and adds explicit currency selection: devnet USDC accepts up to six decimal places, test credits use integer units, and all-currency views do not compare paid assets without an exchange rate. Development-only fixtures include free, devnet-USDC and TEST_CREDIT examples; production excludes the preview modules.

Evidence and handoff:

- qa/12-landing.md — initial foundation, visually superseded by the chosen port.
- qa/13-directory.md — public contract, cache/privacy/expiry behavior and platform configuration.
- qa/14-guides.md — merged implementation and command/configuration verification.
- qa/visual-port.md — original-source fidelity and video deferral.
- qa/15-final-qa.md — final responsive/accessibility/functional/deployed evidence and explicit limitations.
