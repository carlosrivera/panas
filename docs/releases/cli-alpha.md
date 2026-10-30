Panas alpha.6 includes the native macOS buyer → Docker provider routing fix, the portable free/paid demo prompts and MCPWire 1.1.3. The CLI and matching Linux ARM64 Docker image come from the same clean source commit.

The gateway publishes one explicitly reserved UDP port and shares bounded connection hints only through the encrypted private handoff. The CPU worker keeps networking disabled. Existing non-root, read-only filesystem, capability and resource restrictions remain in place. No host networking, Docker socket or native inference fallback is added.

Install or upgrade:

```sh
curl -fsSL https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.6/install.sh -o /tmp/panas-install.sh
sh /tmp/panas-install.sh
~/.local/bin/panas provider --free
# On the buyer computer, after owner configuration:
~/.local/bin/panas demo-prompt
```

Stop existing provider/buyer processes before upgrading; preserve identities, keys, model data, sessions and durable state. Public service bases remain `https://panas.mcpwire.co/registry` and `https://panas.mcpwire.co/accounting`. The installer preserves private owner files.

The shipped demo prompt has no developer-specific home path or fixed provider ID. `panas codex-config` generates the installed Node/package paths for the current user; enrollment and owner configuration are still required. The provider requires Apple Silicon macOS 14+, Docker Desktop and the pinned model; the buyer needs Node.js 24 and an MCP client.

Testing is intentionally deferred for this publication at the maintainer’s request: no fresh unit, integration, sandbox, inference, installer or post-release smoke tests were run. Artifacts were built and packaged with matching source metadata and SHA-256 checksums. Prior native macOS demo evidence is recorded in #56; this publication does not claim a new run. Two physical Macs and other network/NAT paths remain manual acceptance checks.

Mainnet and automated on-chain payouts remain disabled.

Installer hotfix (2026-10-30): the alpha.6 `install.sh` and its entry in
`SHA256SUMS` were updated to pin Ink's transitive `es-toolkit` dependency to
1.53.0 because npm advertised 1.53.1 while its tarball returned 404. The CLI
tarball, Docker image, source metadata and their checksums are unchanged. The
corrected installer was verified with an empty npm cache, repeat installation,
checksum rejection and MCPWire native dependency loading.
