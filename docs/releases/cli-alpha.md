Panas hackathon demo CLI. The provider launcher requires macOS 14+ on Apple Silicon and Docker Desktop; gateway/worker execution is Linux ARM64. The buyer requires Node.js 24 and an MCP client, not a Mac, Docker or a local model. Buyer process supervision supports macOS/Linux; Windows supervision is outside the current matrix.

Download `install.sh` from this release, then run `sh ~/Downloads/install.sh`. It installs the checksum-verified compiled CLI under your home directory. With operator-provided configuration in `~/.config/panas`:

```sh
~/.local/bin/panas provider --free
~/.local/bin/panas demo-prompt | pbcopy
```

Paste the prompt into Codex to configure the buyer MCP, discover a ready provider, accept one free zero-charge request, execute it once and verify its receipt. `panas codex-config` emits Codex TOML with absolute executable paths; `panas mcp-config` emits generic MCP JSON.

Docker Desktop, a matching release image, pinned model installation, enrollment and private configuration are required. The public provider path uses a Docker gateway and separate network-disabled CPU inference worker, with read-only roots, non-root identities and bounded resources. No native fallback, host home, Docker socket or treasury mount is supported. See `docs/docker-sandbox.md` for limits and validation. A CLI release does not deploy the matching Volcano backend. Mainnet and automated wallet payouts remain disabled.
