Panas prototype CLI for macOS 14+ on Apple Silicon, using test credits and fixed per-request pricing.

Run without cloning the repository (Node.js 24 required):

```sh
npx --yes --package=https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.1/panas-cli-0.1.0-alpha.1.tgz panas --help
```

Use `panas identity init --dir /absolute/new/private/directory` to create a fresh provider identity. Operator enrollment, the platform public key and private configuration are still required. Install the dedicated Ollama 0.40.12 runtime and pinned qwen2.5:0.5b model explicitly. Start with `panas provider --env-file /absolute/private/provider.env`; `panas buyer --env-file ...` exposes the buyer MCP facade.

The compiled tarball retains pinned external MCPWire 1.1.0, separate disposable peer adapters and the owned-process guardian. `release.json` records the exact clean source commit and runtime/model pins. `SHA256SUMS` covers the tarball. No private keys, credentials, model weights, source maps or TypeScript source ship in it. Built JavaScript remains readable.

Read [installation and Mac B setup](https://github.com/carlosrivera/panas/blob/v0.1.0-alpha.1/docs/distribution.md). Control-plane compatibility: deployed revision 281033a964c98a9a173d440030586dd64fb7135b. No Volcano deployment accompanies this CLI release.

This is an alpha for the #10 manual two-Mac tests. Physical sleep/wake, two-host/NAT connectivity, a deployed Volcano outage and natural 24-hour expiry remain validation gates. Native supervision does not claim hostile-code sandboxing or hardware attestation.
