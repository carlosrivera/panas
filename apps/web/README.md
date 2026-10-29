# Panas web

Informational Next.js App Router frontend. The homepage describes the prototype without showing fabricated provider availability. `/api/health` reports this web process only; it does not assert registry or inference readiness.

From the workspace root:

```sh
pnpm install
pnpm --filter @panas/web dev
pnpm --filter @panas/web build
pnpm --filter @panas/web typecheck
```

The development server uses port 3333. Styles and reusable primitives live in `@panas/ui`. No external font service or credentials are required to build.
