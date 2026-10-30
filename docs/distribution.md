# Hackathon demo: provider and Codex buyer

## TL;DR — get started

Share your Mac’s spare inference capacity for free. With Node.js 24, Docker Desktop, the approved model and your enrolled provider configuration ready, install and start with one command:

```sh
curl -fsSL https://github.com/carlosrivera/panas/releases/latest/download/install.sh | sh && ~/.local/bin/panas provider --free
```

Buying compute? After installing and configuring your buyer identity, run `~/.local/bin/panas demo-prompt` and paste the result into Codex. Buyers need no Docker or local model. The detailed setup below covers enrollment, models and owner configuration.

## Install the CLI

Install the compiled release once. Download [install.sh](https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.5/install.sh) and run:

```sh
sh ~/Downloads/install.sh
```

Requires Node.js **24** with its bundled npm. The installer verifies the tarball against the SHA-256 embedded in the versioned script, installs into `~/.local/share/panas/releases/`, and links `~/.local/bin/panas`. No sudo, source clone, pnpm, shell-profile changes or npm account are needed. If `~/.local/bin` is on PATH, use `panas`; otherwise the full short path below always works. HTTPS/source trust still matters: the script is executable code, and a checksum is not an independent signing/attestation claim.

## Upgrade to alpha.5

Stop the existing provider and buyer MCP processes, then rerun the alpha.5 installer. The CLI loads the matching `panas-provider:0.1.0-alpha.5` Docker image from this release when needed and checks its source revision against the installed CLI.

Preserve enrolled identities, keys, sessions, model data and durable state. Update only these endpoint fields in existing private configuration; the installer does not rewrite owner files:

| Configuration           | Registry base                                          | Accounting base                                            |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Provider `provider.env` | `PANAS_REGISTRY_URL=https://panas.mcpwire.co/registry` | `PANAS_ACCOUNTING_URL=https://panas.mcpwire.co/accounting` |
| Buyer owner JSON        | `"registryUrl": "https://panas.mcpwire.co/registry"`   | `"accountingUrl": "https://panas.mcpwire.co/accounting"`   |

Restart the provider and reconnect the buyer MCP after updating. Alpha.5 preserves mounted base paths while signing service-relative backend paths. Earlier CLI/Docker builds do not support these mounted URLs.

## One-time operator handoff

An operator enrolls each provider's public identity and a buyer with a fresh owner-approved session (zero balance and zero money caps work for free providers). This prototype is an authorized marketplace; a public listing or MCPWire ticket does not grant execution. Keep operator database/signing credentials on the operator's computer.

On each provider Mac:

- macOS 14+ on Apple Silicon, Docker Desktop, and explicitly installed **qwen2.5:0.5b** model with digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`. Copy the approved model cache from the operator Mac if desired. The matching Docker image contains the pinned Linux runtime; no host Ollama binary is used for serving. Launch never downloads weights silently.
- Generate a new identity with `~/.local/bin/panas identity init --dir "$HOME/.config/panas"`. Give only its UUID and `provider-public.pem` to the operator. Keep `provider.pem` local. Never copy a different Mac's provider state/key.
- Obtain the platform **public** PEM through a trusted channel; current SHA-256 SPKI fingerprint is `804e30700efdee88a0833bab3fc88c1e13d8591e57c600233d7579ef452c7353`.
- Use the release's `provider.env.example` to create `~/.config/panas/provider.env` with mode0600. Fill the UUID and absolute runtime/model/key/state paths. The default free demo uses zero price; `--free` enforces it. A paid devnet demo uses `--solana-devnet --price-atomic 10000` with the separately configured devnet-USDC buyer/backend. Retain the same state/key for restarts. An existing identity directory is never overwritten.

On the buyer computer, the operator supplies an enrolled buyer configuration plus its private key, discovery credential and platform public key. Every file is mode0600; the dedicated state directory is mode0700. See [buyer configuration schema](../apps/buyer-mcp/README.md#owner-setup). Create mode0600 `~/.config/panas/buyer.env` containing:

```sh
PANAS_BUYER_CONFIG=/absolute/private/buyer.json
```

The owner-selected session must be valid. Free access requires no funded balance or positive money caps; paid devnet access requires matching asset, confirmed prepaid balance and sufficient owner authority. Do not solve expired sessions or writer locks by clearing durable state. Buyer and provider can run on separate Macs; the second physical Mac remains a manual acceptance test.

The buyer needs Node.js 24 and the MCP facade, not a Mac, Docker or a local model. macOS/Linux process supervision is supported; Windows process-tree supervision remains outside the current matrix. `pbcopy` below is an optional macOS clipboard convenience; on Linux, run `panas demo-prompt` and copy its output.

## Command 1: start sharing the provider

```sh
~/.local/bin/panas provider --free
```

Require `state: ready` and `peerProbe: verified`, then leave it running. Ctrl-C stops its owned processes. Use the same command to restart with retained key/state. A local separate-peer probe does not establish cross-Mac/NAT reachability. `panas doctor` runs local capability tests and exits; stop the host first because it must own its dedicated runtime port. Override default configuration with `--env-file /absolute/private/provider.env`.

## Command 2: get the Codex setup and test prompt

```sh
~/.local/bin/panas demo-prompt | pbcopy
```

Paste into a new Codex chat. The prompt asks Codex to merge the output of `panas codex-config` into its MCP configuration, discover a ready provider and make at most one free request with all quote/receipt amounts zero. It requires original-request retrieval after uncertainty and a real receipt; it must stop rather than simulate an absent provider. The default prompt authorizes no spending. Use `panas demo-prompt --paid` with a separately enrolled devnet-USDC buyer for the blockchain path; see [payment setup](payments.md).

You may inspect the generated configuration first:

```sh
~/.local/bin/panas codex-config
```

The TOML table uses absolute Node/CLI paths and a 120-second tool timeout. It contains local configuration paths, not credentials. Merge only `[mcp_servers.panas]` into `~/.codex/config.toml`; preserve the other settings. Start a new chat or reconnect MCP if the current tool catalog is stale. In the Codex CLI, `/mcp` shows active servers. These commands follow the [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp). `panas mcp-config` still emits standard `mcpServers` JSON for other clients; that JSON is not Codex's TOML configuration format.

## Isolation: what this demo actually provides

The provider requires two Docker containers: an internet-facing gateway and a separate network-disabled CPU inference worker. Both run non-root with read-only roots, bounded resources, dropped capabilities and no-new-privileges. Only approved model files and dedicated application/IPC volumes are mounted; neither receives the Docker socket, host home or treasury keys. Startup fails closed instead of falling back to native Ollama. See the exact controls, limitations and validation requirements in [Docker sandbox](docker-sandbox.md).

Docker Desktop must be running, the matching release image must be available, and the model must be installed locally. Native Metal acceleration is not used. Old alpha.1/alpha.2 releases were unsandboxed and must not be used for public serving.

## Release and provenance

Current source pins external **MCPWire 1.1.3**, including its upstream b4a fix and explicit UDP peer routes for native-to-Docker connectivity (published alpha.4/alpha.5 pin 1.1.1 and does not include that routing fix); Panas's temporary direct b4a dependency is removed. `panas --version` reports source commit/dirty flag, runtime/model pins and `isolation: docker-gateway-offline-worker-cpu`. The immutable alpha.1/alpha.2 releases remain available. No Volcano deployment accompanies a CLI release.

Maintainers use pinned pnpm: `pnpm format:check`, `pnpm check`, `pnpm release:pack`, `pnpm release:smoke`. Tag publication repeats checks, installs via a fresh npx cache, tests the compiled adapter/IPC and buyer configuration, checks clean provenance, then uploads the tarball, installer, checksum file, public release metadata, prompt and environment example. No private keys, credentials, TypeScript source, source maps or model weights ship. Compiled JavaScript remains readable.
