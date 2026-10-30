# Install Panas without a source clone

The prototype CLI is a compiled npm-format tarball attached to a public GitHub prerelease. It runs with Node.js **24**; pnpm and a repository checkout are only needed by maintainers. The package contains built JavaScript, the owned-process guardian, licenses, release metadata and a sample environment. It keeps **@mcpwire/cli 1.1.0** as an external dependency. Ollama, model weights, private identities and owner configuration are not included.

## Run the pinned release

```sh
npx --yes --package=https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.1/panas-cli-0.1.0-alpha.1.tgz panas --version
```

Use this exact package URL for all commands below. `npx panas` alone is not this release: a short package-name command requires separate npm registry publication. npm supports tarball URLs as package specs ([npm package specs](https://docs.npmjs.com/cli/v11/using-npm/package-spec/), [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/)). Repository development continues to use pinned pnpm.

To verify the downloaded artifact yourself, download the `.tgz` and `SHA256SUMS` from the same release, run `shasum -a 256 -c SHA256SUMS`, then use `npx --yes --package=/absolute/path/panas-cli-0.1.0-alpha.1.tgz panas --version`. Checksums detect changed bytes; they are not an independent signing/attestation claim. `--version` prints the package version, source commit/dirty flag and native pins. A published artifact must have `sourceDirty: false`.

## Mac B setup

1. Install Node 24 on macOS 14+ Apple Silicon. Explicitly install a dedicated **Ollama 0.40.12** bundle and **qwen2.5:0.5b** model with digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`. You may copy the approved runtime and model blobs from Mac A; do not copy Mac A's private identity/state. Launch never silently downloads a model.
2. Generate a fresh identity in a new private directory.:

```sh
npx --yes --package=https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.1/panas-cli-0.1.0-alpha.1.tgz panas identity init --dir "$HOME/.config/panas-mac-b"
```

3. Give only the printed UUID and `provider-public.pem` to the operator on Mac A for enrollment. `provider.pem` stays on Mac B. Obtain the platform **public** PEM through a trusted channel; current SHA-256 SPKI fingerprint is `804e30700efdee88a0833bab3fc88c1e13d8591e57c600233d7579ef452c7353`. Operator credentials and platform signing keys stay on Mac A.
4. Copy `provider.env.example` from the release into that private directory as `provider.env`; replace all paths and the provider UUID. Paths must be absolute; Node's env loader does not expand `~`. Choose a fresh state directory, then preserve it and the key for restarts. Set `chmod 600 "$HOME/.config/panas-mac-b/provider.env"`.
5. Launch the host:

```sh
npx --yes --package=https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.1/panas-cli-0.1.0-alpha.1.tgz panas provider --env-file "$HOME/.config/panas-mac-b/provider.env"
```

Require `state: ready` and `peerProbe: verified`. Leave it running; Ctrl-C shuts down its owned processes. Restart with the same pinned package/key/state. Do not clear state to resolve an unknown request. `panas doctor --env-file ...` runs the local capability suite and exits, without enrollment/publication; stop the host first because the runtime port must be vacant.

The operator's existing enrollment and buyer integration harness remain on Mac A. Run the physical two-Mac protocol from Mac A while this packaged provider runs on Mac B. Local separate-peer readiness does not prove cross-Mac/NAT connectivity. This prerelease does not close #10 or replace physical sleep/wake, deployed outage, or natural 24-hour expiry observations.

## Buyer agent

The same tarball exposes `panas buyer --env-file /absolute/private/buyer.env`. That file contains `PANAS_BUYER_CONFIG=/absolute/private/buyer.json`; the existing owner-authorized buyer configuration and private files are still required. Set MCP client command to `npx`, arguments to `--yes`, the exact `--package=...tgz` URL, `panas`, `buyer`, `--env-file`, and that path. Buyer stdout is MCP JSON-RPC; startup errors are generic stderr messages.

## Maintainer release

Use Node 24 and the repository's pinned pnpm. Run `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm check`, `pnpm release:pack`, and `pnpm release:smoke`. The smoke installs the tarball into a clean directory outside the repository and exercises its real executable/adapter. Commit all source first and rebuild so release metadata records a clean exact commit. Upload the `.tgz`, `SHA256SUMS`, `release.json`, and `provider.env.example` to the prerelease tagged at that commit. GitHub's automatically generated source archives remain available; consumers use the compiled `.tgz` asset. This release is compatible with deployed control-plane revision `281033a964c98a9a173d440030586dd64fb7135b`; publishing it does not deploy Volcano.
