# Hosting and deployment

The public entry point stays **https://panas.mcpwire.co/**. Provider and buyer API URLs stay **https://panas.mcpwire.co/registry** (including `/registry/mcp`) and **https://panas.mcpwire.co/accounting**.

## Website: GitHub Pages with Cloudflare routing

`.github/workflows/pages.yml` builds the Next.js static export on GitHub Actions with Node24 and pnpm12.16.1 and publishes `apps/web/out` to GitHub Pages. The origin is `https://carlosrivera.github.io/panas/`; it is not the public website URL. The artifact intentionally has an empty Next.js base path and canonical metadata for `https://panas.mcpwire.co`. The Cloudflare Worker maps public paths to the Pages origin's `/panas` prefix. No custom domain is assigned to the Pages project, so Pages cannot redirect API requests or replace the Volcano origin.

Cloudflare zone `mcpwire.co` uses these routes, with more-specific routes taking precedence:

| Route                          | Worker                                                   |
| ------------------------------ | -------------------------------------------------------- |
| `panas.mcpwire.co/registry*`   | None: bypass Workers and use the existing Volcano origin |
| `panas.mcpwire.co/accounting*` | None: bypass Workers and use the existing Volcano origin |
| `panas.mcpwire.co/*`           | `panas-web-router`                                       |

The `panas` CNAME continues pointing to `b694dc37-574c-4668-adf0-9371a728f16f.frontends.volcano.run`, with Cloudflare proxying enabled. A hostname-specific Configuration Rule (`http.host eq "panas.mcpwire.co"`) sets SSL to Strict so the origin certificate is validated without changing TLS settings for other subdomains. Keep `_volcano` ownership TXT and `_acme-challenge.panas` CNAME records for Volcano ownership and certificate renewal. Do not repoint `panas` to GitHub Pages or remove the Volcano frontend/function-route configuration.

Worker source and configuration are in `scripts/edge/`. It streams static responses, preserves video Range requests, rewrites Pages redirects back to the public hostname, and never forwards browser authorization, cookies or query strings to GitHub. API exclusions avoid Worker execution and quotas on API calls. The Worker also forwards original API requests intact as defense in depth if an exclusion is absent.

A logged-in, zone-authorized operator can deploy the router with pinned Wrangler4.152.0:

```sh
pnpm dlx wrangler@4.152.0 deploy --config scripts/edge/wrangler.jsonc
```

The route exclusions are zone configuration, separate from the Worker deployment. Keep them when updating the router. The existing wildcard routes for other `mcpwire.co` hosts must remain unchanged.

## Backend: Volcano

The dedicated project is `panas` (`7db5f8f4-c378-4ba5-a48f-f435bc4c034b`). Registry, accounting, PostgreSQL and operations remain there. No data migration, key rotation or client configuration change accompanies this website migration.

`pnpm platform:deploy` deploys functions only and verifies backend behavior by default. The GitHub platform workflow likewise uses `--functions-only`, and ignores website-only changes. See [operations](platform/operations.md) for project-scoped credentials, tracked migrations and financial checks. Keep the existing frontend domain/function routes: registry uses `/registry` with `strip_prefix: true`, accounting uses `/accounting` with `strip_prefix: true`. Signatures still bind service-relative paths.

## Verify and roll back

After Pages deployment, verify the origin HTML and referenced assets, then `https://panas.mcpwire.co/` and its guides. Check the `X-Panas-Web-Host: github-pages` header, command-copy interaction, video, current provider listing, filters and a direct provider-detail reload. Public provider reads must retain `Cache-Control: no-store`; unsigned registry/accounting calls must remain rejected, and MCP must keep its streaming behavior. A green Pages job alone does not prove public routing works.

To roll back website routing, return only the `panas` CNAME proxy setting to DNS-only. Its unchanged target then serves the previous Volcano frontend and APIs directly. Do not change client API URLs, state, keys, function routes, ownership TXT or ACME records. To restore a prior static version, rerun `pages.yml` from a known good source revision. Keep routing changes and rollback evidence separate from inference evidence: this migration does not prove a new cross-Mac inference run.

References: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Next.js static export](https://nextjs.org/docs/app/guides/static-exports), [Cloudflare Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).
