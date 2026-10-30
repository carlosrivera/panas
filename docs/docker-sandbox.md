# Docker provider boundary

Public providers require Docker Desktop on the Apple Silicon Mac. The CLI has no native fallback. This replaces the earlier native-only prototype; old native release and recovery evidence does not establish Docker acceptance.

`panas provider --free` (or `--solana-devnet --price-atomic 10000`) launches two non-root Linux ARM64 containers from the matching release image:

- **Gateway:** MCPWire, its disposable adapters, authorization, private IPC, durable state, cloud accounting and discovery. It has outbound network access for those services and peer connectivity. Only this container receives the provider application key. The key arrives over Docker stdin, is written to a small private tmpfs, and is not placed in Docker arguments, image layers, environment metadata or logs.
- **Worker:** the pinned Ollama runtime and bounded text generation. Networking is disabled, including access to the Mac/LAN/cloud. It receives only the approved model's verified manifest/blobs through a read-only mount and a dedicated 1 MiB tmpfs Unix-socket IPC volume. It receives no provider, platform-signing, buyer or treasury private keys. No model downloads occur during serving.

Both containers use a read-only root, UID 10001, dropped capabilities, no-new-privileges and Docker's default seccomp profile. The gateway is capped at 1 CPU / 1 GiB; the worker at 2 CPUs / 4 GiB; both at 256 processes with swap disabled. Temporary writes are bounded tmpfs mounts. Gateway accounting state lives in the provider-specific Docker volume; do not remove that volume to recover an uncertain request. Container logs are bounded. The persistent state volume does not have a per-provider hard disk quota in this prototype; operators must monitor its growth. There are no published host ports, host networking, host PID/IPC namespaces, privileged/device/GPU passthrough, home-directory mounts or Docker-socket mounts.

The launcher inspects both containers before starting them. Each container also verifies its effective Linux privilege, root-filesystem and cgroup controls. Readiness additionally requires the Docker gateway and worker capability check, pinned model/runtime, bounded inference/cancellation and the existing separate-peer probe. Missing Docker, a mismatched image, failed confinement or failed capability tests prevents readiness. A launcher heartbeat lease closes the gateway after owner loss/suspend; recovery creates a new startup and never replays inference automatically.

## Mac performance

This prototype deliberately runs the small model on CPU inside Docker. [Ollama documents](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) that its normal Docker container on macOS does not have Metal GPU acceleration. Forwarding to native host Ollama would leave the inference runtime outside this boundary and is not supported by this launcher.

## Building and release

Maintainers run `./docker/build.sh` with Node 24 and pinned pnpm. The Docker context is only the compiled distributable, not the checkout or home directory. Official Node/Ollama bases are digest-pinned; unused GPU libraries are excluded from the final image. The release workflow uploads a matching compressed Linux ARM64 Docker image archive alongside the CLI assets. The CLI verifies its release checksum before loading it into the local engine; no registry login is required. Startup resolves the image to an immutable ID and requires its source labels to match the CLI metadata. `--sandbox-image <reference>` is available for a locally built matching development image; it does not relax sandbox requirements.

The Mac model installation is read locally and a minimal temporary staging tree is created with only the pinned manifest and hash-verified referenced blobs. It is removed after shutdown. Existing native application state is not automatically imported into the new Docker volume. Reconcile outstanding native requests before switching. Interrupted Docker requests retain their volume and cloud reservation and use the existing audited reconciliation process.

## Limits

Docker containment reduces access to the owner's Mac and separates inference from gateway credentials. It is not hardware attestation, confidential inference, trustless usage metering or a guarantee against kernel/VM/runtime vulnerabilities. The gateway necessarily has network egress, including Docker-reachable host/LAN services, and its own application credential; a gateway destination allowlist is not implemented. A compromised gateway can exercise that provider identity. Never provide it a treasury key. Model text remains data; arbitrary shell/filesystem tools are not exposed to buyers.

Security acceptance requires actual container denial probes (host canary, read-only writes, worker egress, socket/credential absence, effective resource controls), a real CPU inference/cancellation run, and peer/accounting/recovery drills. Repository fixture tests alone do not establish these properties on an operator's Docker engine. Production treasury custody and on-chain payouts remain separate work in issue #49.
