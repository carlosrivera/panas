# External MCPWire transport

`@panas/mcpwire` supervises the pinned `@mcpwire/cli` 1.1.0 binary. It reads the installed package's public `bin.mcpwire` metadata and checks its version; it does not import private implementation modules. Processes run without a shell, with pipes and a separate POSIX process group.

## Consumer contract

- `superviseShare({command, args?, startupTimeoutMs?, shutdownGraceMs?, signal?, onEvent?})` starts sharing a **disposable stdio MCP adapter**. `ready` resolves to `ready` with a private `ticket` and `generationId`, or a typed `failed`/`timeout` outcome. A captured ticket proves the CLI advertised its tunnel, not peer reachability.
- `superviseJoin({ticket, ...options})` starts a separate MCPWire peer process and performs the MCP `initialize`/`notifications/initialized` exchange. `ready` resolves after initialization. `request(method, params?, {timeoutMs?})` performs JSON-RPC requests with independent IDs and bounded messages. The protocol offered/accepted by this initial client is `2025-11-25`.
- Both return `closed`, `stop()`, and `generationId`. Metadata-only event callbacks report readiness, failure/timeout, and closure. Requests rejected on timeout, remote error, or disconnect have an **uncertain** execution outcome: retrieve original application request state rather than replaying it.
- `probePeer({ticket?, startupId, timeoutMs?, signal?, ...options})` returns `verified`, `failed`, or `unverified`. No ticket means `unverified`. A successful probe calls `get_capabilities` through a separately initialized join process and requires `result.structuredContent.startupId` to match the requested startup. The caller must bind `testedAt` and the startup to its current report. The disposable host adapter is a later integration in issue #6.
- `launch` is a trusted executable override for subprocess fixtures; never construct it from remote tool arguments.

A successful local probe records `evidence: separate-process-local-peer`. It establishes a real separate peer process and an MCP round trip on this machine; it does **not** establish two physical Macs, external-network reachability, hardware attestation, model quality, payment authorization, or inference readiness. A deployment can run a remote probe service later and must label that evidence separately.

## Lifecycle and rotation

Startup defaults to 35 seconds. Shutdown signals the entire POSIX group with SIGTERM, waits a bounded grace period, and sends SIGKILL to the group even if the leader exited early. This covers MCPWire's spawned per-peer adapters on supported macOS and Linux environments. Windows process-tree supervision is outside the prototype support matrix.

The application owns session rotation: await `stop()` and `closed`, start a fresh share, and publish its new private descriptor bound to the new application startup/session identity. A generation ID is unique per launch. There are no transparent reconnects, retries, or application calls on restart. Existing descriptors must be invalidated by the consumer on `closed`; the resolved initial `ready` value is not ongoing readiness.

MCPWire starts an MCP server per peer and kills that server on peer disconnect. Keep model ownership, limits, durable requests, and results in the persistent application daemon outside that process group. The integration fixture demonstrates this boundary using a Unix-domain-socket daemon: connecting again yields a new adapter PID while daemon identity and counter persist. Actual production daemon/MCP authentication integration belongs to issue #6.

## Private output and upstream logging gap

The pinned noninteractive CLI writes its human banner and client config to **stderr**, not stdout. `PrivateShareParser` recognizes the versioned listening line followed by the exact config args array; it handles split chunks and caps startup output at 64 KiB. This format-dependent parser is isolated. A format change or excessive startup output fails closed. A future upstream JSON readiness mode can replace this parser.

Managed sessions never expose raw child stdout/stderr or include them in events/errors. Share stderr is parsed privately until a ticket is captured and discarded afterwards; join stderr is discarded throughout. Tickets only appear in the explicitly private share-ready descriptor supplied to authorized application code. Do not serialize that descriptor to logs or public discovery. No recording flags are enabled. The legacy low-level `startMcpwire` export returns raw child streams and is only suitable for trusted tooling; production consumers should use managed sessions.

Inspection of the installed 1.1.0 binary confirms the upstream share path logs `JSON.stringify(arguments).slice(0, 160)` on a forwarded tool call, and its recorder would store argument previews if enabled. `--redact-secrets` scrubs outbound responses, not inbound argument previews. Therefore it is insufficient protection for prompts, signatures, or payment envelopes. Panas suppresses this upstream stderr entirely. Do not forward it to a terminal, telemetry collector, file, or logger. Authentication must use reviewed opaque references and operation-bound signatures; never send reusable authorization secrets as tool parameters. Production host-adapter authentication and logging integration remain issue #6; this transport does not declare an unimplemented envelope safe. Upstream disabling or sanitizing argument-preview logs would be a useful separate improvement.

## Verification

```sh
pnpm exec vitest run packages/mcpwire/src
PANAS_REAL_PEER=1 pnpm exec vitest run packages/mcpwire/src/real-peer.test.ts
```

Deterministic tests cover subprocess startup/failure/timeout, fragmented private output, RPC correlation and uncertain disconnect/timeouts, process-tree cleanup, missing/stale probe evidence, and explicit rotation. The opt-in network smoke uses actual installed MCPWire share/join processes with a simple MCP fixture and a separate persistent IPC daemon. It requires network access to the public discovery network and can fail on restricted NAT/firewalls. Neither test snapshots tickets or private argument data.
