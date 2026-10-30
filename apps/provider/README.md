# Provider daemon and Docker worker

This package implements the persistent inference lifecycle, capability checks, bounded queue, encrypted request store and worker runtime. The public provider runs through the CLI's two-container Docker launcher. Authentication, discovery publication, peer adapters and terminal-event delivery are integrated by [the provider controller](../provider-mcp/README.md).

## Supported execution path

Use [distribution setup](../../docs/distribution.md) to install the matching CLI/image, enroll a provider, pin the platform public key and prepare the approved model. The launcher currently targets Apple Silicon macOS 14+ with Docker Desktop. Gateway and worker run Linux ARM64 containers; other hosts/architectures require validation. The buyer does not need a Mac, Docker or a model.

```sh
~/.local/bin/panas provider --free
```

For a fixed 0.01 devnet-USDC price:

```sh
~/.local/bin/panas provider --solana-devnet --price-atomic 10000
```

Only the provider owner chooses price; buyer funding/enrollment follows [the payment protocol](../../docs/payments.md). No treasury signing key belongs in the provider configuration.

Serving uses the pinned Linux Ollama runtime from the matching image and the hash-verified `qwen2.5:0.5b` model cache staged read-only by the launcher. No weights download during serving. The worker runs on CPU with networking disabled; no host Ollama or Metal fallback exists.

`createProviderRuntime` verifies the gateway container profile and uses `DockerWorkerRuntime` to call the worker through authenticated `/ipc/runtime.sock`. Only the worker owns the actual Ollama process and its private loopback endpoint. No runtime port is published on the host. The old direct native host commands are not the current serving path: starting the package entry point on an unconfined host fails its container check.

For local capabilities, stop the owned provider first and use the compiled CLI's `panas doctor` command with the same private environment. It launches the required Docker boundary and checks confinement, Linux ARM64 identity, memory/disk, pinned runtime/model, cold/warm generation, output bounds and cancellation/restart. Passing local checks leaves `testing` and `peerProbe.status=unverified`; the controller must obtain a fresh separate-peer proof and publish successfully before readiness.

## Lifecycle, admission and durable state

The persistent daemon owns one active request and a queue of two across every peer adapter. Requests are text-only, with a 2,048-token context profile, at most 128 output tokens and a 60-second deadline. Conservative UTF-8 byte admission reserves output/context headroom; it does not claim independent tokenizer verification. Model output never executes tools or commands.

`ProviderDaemon` exposes launch/retest, report/status, startup-bound peer verification, gated heartbeat, health, submit/get/cancel, pause/resume/drain and emergency stop. Health gaps and model/runtime changes invalidate readiness; recovery requires fresh local checks and peer evidence. Cancellation stops the dedicated worker runtime and requires retesting before new work.

The controller and trusted local adapters communicate through a mode-0600 Unix socket and local token in private gateway state. The host adapter verifies buyer grants and operation proofs before daemon admission; the local IPC token is not buyer authorization and never leaves the gateway.

Results and request metadata use AES-256-GCM, fsynced temporary writes and atomic rename. Completed results are durable before being exposed. Duplicate request IDs retain their existing identity; altered payloads conflict and another buyer cannot retrieve them. Interrupted running records recover as `unknown`, without automatic reexecution. Retain the provider-specific Docker state volume, encryption keys, replay state and terminal outbox across restart. Results expire after 24 hours and request/receipt metadata after 30 days.

## Isolation and recovery limits

The gateway has network access and the provider application key; the worker has neither network access nor application/treasury private keys. Both use non-root identities, read-only roots, dropped capabilities, seccomp and CPU/memory/PID limits. See the complete [Docker boundary](../../docs/docker-sandbox.md), including gateway egress and disk-growth limits.

The launcher heartbeat lease closes the gateway after owner loss/suspend. Container-scoped ownership permits retained-volume recovery without adopting a live predecessor. Recovery preserves durable outcomes and publishes a new startup; it never silently replays inference. [Crash](../../docs/integration/provider-crash.md) and [sleep/wake](../../docs/integration/provider-sleep-wake.md) documents distinguish component tests from outstanding physical drills.

Encryption does not hide content from the provider operating the machine. Docker is not hardware attestation or confidential inference, and runtime usage counts are provider assertions.

## Validation

Run `pnpm format:check` and `pnpm check` from the root. [Current Docker validation](../../docs/validation/docker-sandbox.md) records actual confinement probes, local CPU inference and cancellation/restart. Earlier native observations below do not establish Docker peer/accounting or physical recovery acceptance. See [integration evidence](../../docs/integration/README.md) for those separate gates.

### Historical native hardware validation (October 28, 2026)

A real Apple Silicon Mac running macOS 27.0.1 with 16 GiB memory passed all nine local checks using Ollama 0.40.12 and the explicitly downloaded model digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`. One short eight-output-token warm fixture measured 60.55 ms / 132.13 output tokens per second; this is a smoke measurement, not a service-level guarantee.

The real daemon CLI also launched its own loopback runtime, exposed a mode 0600 Unix socket, reported `testing/unverified`, returned no eligible heartbeat, rejected an unverified inference submission, supported pause/resume, and closed its dedicated runtime on SIGTERM. It did not touch the separate setup runtime or download a model. No separate-peer test, remote paid authorization, registry publication, or cloud deployment is claimed by this evidence.
