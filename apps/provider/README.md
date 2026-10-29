# Provider daemon

This package implements issue #2's native macOS worker and capability checks. It is a trusted local application component, not a public inference API. Paid authorization and the disposable MCP host adapter belong to issue #6; registry publication and MCPWire separate-peer probing are integration consumers.

## Explicit setup

Install an approved Ollama release and explicitly download `qwen2.5:0.5b` into a dedicated model directory. No code in this package pulls models or adopts a running server. Obtain the full model digest from that installation's `/api/tags` and pin it together with the exact approved runtime version.

Set these values in your shell; keep application state outside version control:

```sh
export PANAS_PROVIDER_ID='<uuid>'
export PANAS_OLLAMA_BINARY='/absolute/path/to/ollama'
export PANAS_MODELS_PATH='/absolute/path/to/dedicated/models'
export PANAS_MODEL_DIGEST='<full-sha256-digest>'
export PANAS_OLLAMA_VERSION='<approved-version>'
export PANAS_DATA_PATH='/absolute/path/to/private/panas-provider'
export PANAS_OLLAMA_ENDPOINT='http://127.0.0.1:11536'
pnpm --filter @panas/provider run doctor
pnpm --filter @panas/provider run start
```

Use a separate unused port. The daemon refuses an occupied port instead of mutating or stopping an existing Ollama server. It owns the process group it launches and terminates only that group. Runtime stderr is not retained because it can contain prompt metadata. A dedicated instance uses loopback, one loaded model, one parallel request, a 2,048-token context, and cloud features disabled.

`doctor` checks macOS 14+ on Apple Silicon, physical memory/free disk, explicit runtime version and model digest, bounded cold/warm inference, raw generation counts, output cap, and cancellation with owned-process-group termination/restart. It prints a report and exits successfully only if local checks pass. A local success is `testing` with `peerProbe.status=unverified`, never `ready`. A matching separate-peer probe newer than the test is required through the daemon integration API before readiness/heartbeat eligibility.

## Lifecycle and IPC

The daemon owns inference independently of per-peer MCP child processes. Admission is one active request and a queue of two. Inputs use raw Qwen2.5 generation; a conservative UTF-8 byte ceiling reserves output and special-token context headroom rather than advertising an independently verified tokenizer. Prompts are text only. The worker never executes generated tools or commands. Requests run with a 60-second generation deadline. A running cancellation aborts and terminates the dedicated runtime fail-safe, invalidates readiness, and requires fresh tests plus a peer probe before new work.

`ProviderDaemon` exposes launch/retest, report/status, startup-bound verifyPeer, gated heartbeat, health checks, submit/get/cancel, pause/resume/drain, and emergency stop. Health gaps longer than 45 seconds invalidate readiness and trigger retest when idle. Idle unhealthy workers are also retested by the health loop; recovery always returns to unverified connectivity and needs a new peer proof. Runtime revision/digest changes invalidate readiness. Pausing rejects new work and holds queued work; draining rejects new work and completes accepted work.

`start` opens only `PANAS_DATA_PATH/daemon.sock`. The parent directory is private and socket mode is0600. Every newline-delimited JSON IPC message also requires the random local token stored mode 0600 in `ipc-token`; it is not paid buyer authorization. Available methods are status, heartbeat, pause, resume, drain, stop, retest, submit, get, and cancel. Local callers are trusted adapters belonging to the same OS account. The future host adapter must authenticate buyer entitlement before calling submit and must never expose this administrative token over MCPWire.

Results and request metadata use AES-256-GCM with a generated local 0600 key inside the private store directory, fsynced temporary-file writes and atomic rename. A durable completed result is saved before it is visible as completion. Duplicate IDs return the known record; altered payloads conflict and other buyer identities cannot retrieve it. Restarted running records become `unknown` and are not reexecuted. Results expire after 24 hours and receipt metadata after 30 days during periodic cleanup; requests must be reconciled by the future control plane. Encryption at rest does not hide content from the provider account that owns the key.

## Validation and limits

Run `pnpm exec vitest run apps/provider/src/provider.test.ts`, `pnpm format:check`, and `pnpm check` from the repository root. Injectable tests exercise unavailable runtime, changed pins, unsupported hosts, probe freshness, global queue, cancellation, retention/recovery, and IPC isolation. Real hardware evidence must be recorded separately; fixture success is not a claim that the model or cloud path was exercised.

This is not a hostile-code sandbox, a hard GPU/unified-memory partition, a proof of token honesty, or a complete paid product. Real remote host authentication, signed report publication, the separate-peer probe source, registry upload, quote/ledger integration, and sleep notification callbacks remain integration work. The health-gap guard handles wake after process suspension but is not a native macOS power-event listener. No control-plane heartbeat is published by this package alone.

Ollama API behavior follows the official [generation API](https://docs.ollama.com/api/generate) and [runtime configuration FAQ](https://docs.ollama.com/faq). The application retains only counts and durations reported by its local runtime, not independent execution attestation.

### Hardware validation (October 28, 2026)

A real Apple Silicon Mac running macOS 27.0.1 with 16 GiB memory passed all nine local checks using Ollama 0.40.12 and the explicitly downloaded model digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`. One short eight-output-token warm fixture measured 60.55 ms / 132.13 output tokens per second; this is a smoke measurement, not a service-level guarantee.

The real daemon CLI also launched its own loopback runtime, exposed a mode 0600 Unix socket, reported `testing/unverified`, returned no eligible heartbeat, rejected an unverified inference submission, supported pause/resume, and closed its dedicated runtime on SIGTERM. It did not touch the separate setup runtime or download a model. No separate-peer test, remote paid authorization, registry publication, or cloud deployment is claimed by this evidence.

### Host crash recovery

The paid host and local daemon claim their private data directory before recovery and refuse a live predecessor. Detached runtime/transport groups are guarded by parent-liveness IPC; restart retains request/nonce encryption keys and treats interrupted work as unknown, without automatic replay or settlement. See [recovery behavior and the deferred live drill](../../docs/integration/provider-crash.md). Legacy/untracked sockets and incomplete startup claims require conservative owner review.
