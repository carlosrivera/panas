Panas hackathon demo launcher for macOS 14+ on Apple Silicon. Node.js 24 required.

Download `install.sh` from this release, then run `sh ~/Downloads/install.sh`. It installs the checksum-verified compiled CLI under your home directory. With operator-provided configuration in `~/.config/panas`:

```sh
~/.local/bin/panas provider
~/.local/bin/panas demo-prompt | pbcopy
```

Paste the prompt into Codex to configure the buyer MCP, discover a ready provider, purchase one request capped at 2 atomic TEST_CREDIT, execute it once and verify its receipt. `panas codex-config` emits Codex TOML with absolute executable paths; `panas mcp-config` emits generic MCP JSON.

Native Ollama/model installation, enrollment, private configuration and owner spending authority remain required. The provider is process-supervised, **not OS-sandboxed**. Loopback, authorization and inference bounds do not provide filesystem, outbound-network or hostile-process containment. Model output is data and is never executed.

Pins: MCPWire 1.1.1 (upstream b4a fix), Ollama 0.40.12, qwen2.5:0.5b. The temporary Panas b4a dependency is removed. Metadata/checksums and the public environment example are attached. No real payments or cloud deployment accompanies this release.

[Full setup and isolation limits](https://github.com/carlosrivera/panas/blob/v0.1.0-alpha.2/docs/distribution.md). Physical two-Mac/NAT, sleep/wake, deployed-outage and natural 24-hour expiry gates remain open under #10.
