Panas alpha.7 adds provider and buyer terminal dashboards, automatic personal free-only buyer enrollment, and automatic MCP setup for Codex and Antigravity. Registry and accounting now run on Cloudflare Workers with the existing PostgreSQL database and unchanged public URLs.

Install:

```sh
curl -fsSL https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.7/install.sh | sh
~/.local/bin/panas demo
```

Choose your agent, press c to copy the complete prompt, and paste it into Codex or Antigravity. The agent enrolls its own free buyer and writes its MCP configuration. No account provisioning, owner files, wallet or local model is required for the free buyer demo. Node.js 24 is required. A ready free provider must be available.

`panas hello` performs one bounded free request immediately. After uncertainty, retain the printed request ID and use `panas request REQUEST_UUID`; never replay hello as recovery. Demos have zero spending caps on the client and server and scoped free-only discovery. Paid access and provider enrollment remain operator-managed.

`panas provider --free` opens a live dashboard showing startup stages and verified readiness. Use Tab for activity, c for the public provider link and q to stop owned containers while preserving durable state. Use --plain for scripts. Provider requirements remain Apple Silicon macOS 14+, Docker Desktop and the pinned offline CPU model.

MCP setup preserves unrelated settings and creates local backups. Codex uses its native MCP configuration command; Antigravity uses ~/.gemini/config/mcp_config.json. A client may need to reload MCP servers; the copied prompt can run hello directly in the meantime.

Validation includes repository lint/typecheck/tests/build, isolated PostgreSQL enrollment/authority/settlement tests, fresh-cache installer and packaged MCP checks, and a real fresh-buyer → existing Docker provider request through Cloudflare with an authoritative zero-charge receipt. This is one-machine native buyer/Docker provider evidence; independent physical hosts and other NAT paths remain manual acceptance checks. The release workflow validates and packages the matching Linux ARM64 sandbox image from the same clean source commit.

Mainnet and automatic on-chain payouts remain disabled. Private identities, keys, sessions and durable state are preserved during installation.

Installer wording hotfix: the alpha.7 installer and its checksum were updated to show the automatic free buyer commands and remove obsolete manual buyer setup instructions. The CLI tarball, matching Docker image and their source metadata/checksums are unchanged.
