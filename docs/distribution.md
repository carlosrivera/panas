# Hackathon demo: provider and Codex buyer

Install the compiled release once. Download [install.sh](https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.2/install.sh) and run:

```sh
sh ~/Downloads/install.sh
```

Requires Node.js **24** with its bundled npm. The installer verifies the tarball against the SHA-256 embedded in the versioned script, installs into `~/.local/share/panas/releases/`, and links `~/.local/bin/panas`. No sudo, source clone, pnpm, shell-profile changes or npm account are needed. If `~/.local/bin` is on PATH, use `panas`; otherwise the full short path below always works. HTTPS/source trust still matters: the script is executable code, and a checksum is not an independent signing/attestation claim.

## One-time operator handoff

An operator enrolls each provider's public identity and a buyer with a fresh funded TEST_CREDIT session. This prototype is an authorized marketplace; a public listing or MCPWire ticket does not grant execution. Keep operator database/signing credentials on the operator's computer.

On each provider Mac:

- macOS 14+ on Apple Silicon, a dedicated **Ollama 0.40.12** binary bundle, and explicitly installed **qwen2.5:0.5b** model with digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`. Copy the approved binary/model blobs from the operator Mac if desired. Launch never downloads weights silently.
- Generate a new identity with `~/.local/bin/panas identity init --dir "$HOME/.config/panas"`. Give only its UUID and `provider-public.pem` to the operator. Keep `provider.pem` local. Never copy a different Mac's provider state/key.
- Obtain the platform **public** PEM through a trusted channel; current SHA-256 SPKI fingerprint is `804e30700efdee88a0833bab3fc88c1e13d8591e57c600233d7579ef452c7353`.
- Use the release's `provider.env.example` to create `~/.config/panas/provider.env` with mode0600. Fill the UUID and absolute runtime/model/key/state paths. Keep the fixed price at `2` TEST_CREDIT for this demo. Retain the same state/key for restarts. An existing identity directory is never overwritten.

On the buyer computer, the operator supplies an enrolled buyer configuration plus its private key, discovery credential and platform public key. Every file is mode0600; the dedicated state directory is mode0700. See [buyer configuration schema](../apps/buyer-mcp/README.md#owner-setup). Create mode0600 `~/.config/panas/buyer.env` containing:

```sh
PANAS_BUYER_CONFIG=/absolute/private/buyer.json
```

The owner-selected session must still be valid and have sufficient TEST_CREDIT authority. Do not solve expired sessions or writer locks by clearing durable state. Buyer and provider can run on separate Macs; the second physical Mac remains a manual acceptance test.

## Command 1: start sharing the provider

```sh
~/.local/bin/panas provider
```

Require `state: ready` and `peerProbe: verified`, then leave it running. Ctrl-C stops its owned processes. Use the same command to restart with retained key/state. A local separate-peer probe does not establish cross-Mac/NAT reachability. `panas doctor` runs local capability tests and exits; stop the host first because it must own its dedicated runtime port. Override default configuration with `--env-file /absolute/private/provider.env`.

## Command 2: get the Codex setup and test prompt

```sh
~/.local/bin/panas demo-prompt | pbcopy
```

Paste into a new Codex chat. The prompt asks Codex to merge the output of `panas codex-config` into its MCP configuration, discover a ready provider and make at most one purchase capped at **2 atomic TEST_CREDIT**. It requires original-request retrieval after uncertainty and a real receipt; it must stop rather than simulate an absent provider. This prompt gives bounded spending authorization when you submit it. Remove the purchase step if you want discovery only.

You may inspect the generated configuration first:

```sh
~/.local/bin/panas codex-config
```

The TOML table uses absolute Node/CLI paths and a 120-second tool timeout. It contains local configuration paths, not credentials. Merge only `[mcp_servers.panas]` into `~/.codex/config.toml`; preserve the other settings. Start a new chat or reconnect MCP if the current tool catalog is stale. In the Codex CLI, `/mcp` shows active servers. These commands follow the [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp). `panas mcp-config` still emits standard `mcpServers` JSON for other clients; that JSON is not Codex's TOML configuration format.

## Isolation: what this demo actually provides

**The native provider is not OS-sandboxed.** It runs with the provider account's macOS permissions. The Node host launches the dedicated native Ollama child under an owned-process guardian; no container, VM, App Sandbox entitlement or deny-by-default filesystem/network policy is applied. Apple's [App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox) is a separate OS-enforced capability boundary, not the same as a supervised child process.

Implemented controls: loopback-only model API, fixed approved model, text-only inputs, signed/limited requests, one active inference worker, queue/output/context/deadline limits, encrypted local state, and process-tree cleanup on owner death. The model's output is never executed as shell commands or tools.

Missing isolation: containment of a compromised Ollama/Node process from account-readable files, an outbound-network allowlist, hard GPU/unified-memory partitioning, and protection from the provider inspecting prompts/results. MCPWire's encrypted transport and disposable peer children do not supply those boundaries. Codex's own shell sandbox does not automatically sandbox an external provider on either Mac. Present this as **bounded native inference**, with trusted demo inputs/accounts. An OS-enforced sandbox/VM with validated Metal support and file/network denial tests is tracked in [issue #46](https://github.com/carlosrivera/panas/issues/46); no such protection is claimed here.

## Release and provenance

This release pins external **MCPWire 1.1.1**, including its upstream b4a fix; Panas's temporary direct b4a dependency is removed. `panas --version` reports source commit/dirty flag, native pins and `isolation: native-supervised-no-os-sandbox`. The immutable alpha.1 release remains available. No Volcano deployment accompanies a CLI release.

Maintainers use pinned pnpm: `pnpm format:check`, `pnpm check`, `pnpm release:pack`, `pnpm release:smoke`. Tag publication repeats checks, installs via a fresh npx cache, tests the compiled adapter/IPC and buyer configuration, checks clean provenance, then uploads the tarball, installer, checksum file, public release metadata, prompt and environment example. No private keys, credentials, TypeScript source, source maps or model weights ship. Compiled JavaScript remains readable.
