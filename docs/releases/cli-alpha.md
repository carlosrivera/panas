Panas alpha.8 improves free demo reliability and recovery. Each new user-requested free inference gets its own quote and request ID; zero-spend sessions support multiple requests.

```sh
curl -fsSL https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.8/install.sh | sh
~/.local/bin/panas demo
```

Run `~/.local/bin/panas demo` for MCP setup in Codex or Antigravity, or `~/.local/bin/panas hello` for a free terminal request. Repeat `hello` for an additional request. To retrieve an uncertain request, use `~/.local/bin/panas request REQUEST_UUID` instead of replaying it.

Accounting calls retry temporary failures with the original request and idempotency key. An expired quote may be replaced only after the authoritative service confirms it was never purchased. Inference itself is never automatically replayed.

The Cloudflare API uses a PostgreSQL transport adapter validated against the accounting and registry database suites. PostgreSQL, public API URLs, signing keys and spending limits are preserved.
