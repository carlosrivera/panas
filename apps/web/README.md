# Panas web

Informational Next.js App Router frontend: the user-selected PR27 landing, real public provider directory/details, and buyer/provider setup guides. Browsing never reserves capacity or authorizes a purchase. Agent discovery and purchase use the independent local MCP facade.

From the workspace root, with Node24 and pinned pnpm:

```sh
pnpm install --frozen-lockfile
pnpm --filter @panas/web dev
pnpm --filter @panas/web typecheck
pnpm --filter @panas/web build
pnpm --filter @panas/web start
```

Dev/start default to3333. Use a separate checkout when serving production and rebuilding/developing concurrently; coordinate preview restarts to avoid stale chunks. Dev/build explicitly use webpack to resolve shared Node ESM `.js` source imports to their TypeScript files without changing daemon conventions.

Set only nonsecret server-side `PUBLIC_REGISTRY_URL` to the public registry base URL. The same-origin API appends `/public/providers`; no discovery/operator/database/buyer credentials belong in this app or browser. Missing config fails safely to unavailable. Public reads are no-store, with8s upstream/10s browser timeouts,15s refresh and conservative heartbeat/report expiry. `/api/health` reports the web process only.

Shared styles/primitives live in `@panas/ui`. The original landing CSS is scoped in app/pr27.css. The user deferred the clip: data-src retains `/video.mp4` without requesting it; supply the actual public asset and restore src when resuming that work. Original shader/hover/focus/reduced-motion code remains; no substitute artwork or external font service is used.

Evidence and handoff:

- qa/12-landing.md — initial foundation, visually superseded by the chosen port.
- qa/13-directory.md — public contract, cache/privacy/expiry behavior and platform configuration.
- qa/14-guides.md — merged implementation and command/configuration verification.
- qa/visual-port.md — original-source fidelity and video deferral.
- qa/15-final-qa.md — final responsive/accessibility/functional/deployed evidence and explicit limitations.
