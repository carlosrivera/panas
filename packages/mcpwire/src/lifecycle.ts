import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrivateShareParser } from "./private-output";
import { JsonRpcClient } from "./rpc";
import { joinArgs, shareArgs, MCPWIRE_VERSION } from "./commands";

export interface LaunchCommand {
    command: string;
    args: string[];
}
export type FailureCode =
    | "spawn_failed"
    | "startup_failed"
    | "startup_timeout"
    | "protocol_failed"
    | "aborted";
export type TransportEvent =
    | { kind: "ready"; generationId: string }
    | { kind: "failed" | "timeout"; generationId: string; code: FailureCode }
    | {
          kind: "closed";
          generationId: string;
          code: number | null;
          signal: NodeJS.Signals | null;
      };
export type StartupOutcome =
    | { kind: "ready"; generationId: string }
    | { kind: "failed" | "timeout"; generationId: string; code: FailureCode };
export interface SessionOptions {
    startupTimeoutMs?: number;
    shutdownGraceMs?: number;
    signal?: AbortSignal;
    /** Override executable for subprocess fixtures, never derived from remote tool arguments. */
    launch?: LaunchCommand;
    /** Receives metadata only: no child output, tickets, or RPC payloads. */
    onEvent?: (event: TransportEvent) => void;
}
export function cliCommand(args: string[]): LaunchCommand {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve("@mcpwire/cli/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        version?: string;
        bin?: { mcpwire?: string };
    };
    if (manifest.version !== MCPWIRE_VERSION || !manifest.bin?.mcpwire)
        throw new Error("Unsupported MCPWire installation");
    return {
        command: process.execPath,
        args: [resolve(dirname(manifestPath), manifest.bin.mcpwire), ...args],
    };
}
export function launchCli(
    args: string[],
    override?: LaunchCommand,
): ChildProcessWithoutNullStreams {
    const command = override ?? cliCommand(args);
    return spawn(command.command, command.args, {
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
    });
}
function duration(value: number | undefined, fallback: number): number {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1 || result > 120_000)
        throw new Error("Invalid transport timeout");
    return result;
}
function manage(args: string[], options: SessionOptions) {
    const timeoutMs = duration(options.startupTimeoutMs, 35_000);
    const graceMs = duration(options.shutdownGraceMs, 500);
    const generationId = randomUUID();
    const child = launchCli(args, options.launch);
    let ended = false;
    let failureReported = false;
    let settled = false;
    let stopping: Promise<void> | undefined;
    let settle!: (outcome: StartupOutcome) => void;
    const ready = new Promise<StartupOutcome>((done) => {
        settle = done;
    });
    let closedResolve!: (
        event: Extract<TransportEvent, { kind: "closed" }>,
    ) => void;
    const closed = new Promise<Extract<TransportEvent, { kind: "closed" }>>(
        (done) => {
            closedResolve = done;
        },
    );
    const emit = (event: TransportEvent) => {
        options.onEvent?.(event);
    };
    const complete = (outcome: StartupOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle(outcome);
        emit(outcome);
    };
    const signalGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
            if (process.platform === "win32") child.kill(signal);
            else process.kill(-child.pid, signal);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    };
    const stop = (): Promise<void> => {
        stopping ??= (async () => {
            signalGroup("SIGTERM");
            // Wait through grace even if leader exits: its per-peer descendants may remain.
            await new Promise<void>((done) => setTimeout(done, graceMs));
            signalGroup("SIGKILL");
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
        })();
        return stopping;
    };
    const fail = (code: FailureCode) => {
        if (failureReported) return;
        failureReported = true;
        const outcome = {
            kind:
                code === "startup_timeout"
                    ? ("timeout" as const)
                    : ("failed" as const),
            generationId,
            code,
        };
        if (settled && !ended) emit(outcome);
        complete(outcome);
        void stop();
    };
    const timer = setTimeout(() => fail("startup_timeout"), timeoutMs);
    const onAbort = () => fail("aborted");
    if (options.signal?.aborted) queueMicrotask(onAbort);
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", () => fail("spawn_failed"));
    child.stdin.on("error", () => {
        if (!ended) fail("protocol_failed");
    });
    child.on("close", (code, signal) => {
        ended = true;
        options.signal?.removeEventListener("abort", onAbort);
        if (!settled)
            complete({ kind: "failed", generationId, code: "startup_failed" });
        const event = { kind: "closed" as const, generationId, code, signal };
        closedResolve(event);
        emit(event);
        void stop();
    });
    return {
        child,
        ready,
        closed,
        stop,
        fail,
        markReady: () => complete({ kind: "ready", generationId }),
        generationId,
    };
}

export function superviseShare(
    options: SessionOptions & { command: string; args?: string[] },
) {
    const session = manage(shareArgs(options.command, options.args), options);
    const parser = new PrivateShareParser();
    let privateTicket: string | undefined;
    session.child.stderr.on("data", (chunk: Buffer) => {
        if (privateTicket) return;
        try {
            privateTicket = parser.feed(chunk.toString("utf8"));
            if (privateTicket) session.markReady();
        } catch {
            session.fail("protocol_failed");
        }
    });
    // Never expose raw CLI output. The share CLI logs tool argument previews on stderr.
    session.child.stdout.resume();
    const ready = session.ready.then((outcome) =>
        outcome.kind === "ready"
            ? { ...outcome, ticket: privateTicket! }
            : outcome,
    );
    return {
        ready,
        closed: session.closed,
        stop: session.stop,
        generationId: session.generationId,
    };
}

export function superviseJoin(options: SessionOptions & { ticket: string }) {
    const session = manage(joinArgs(options.ticket), options);
    session.child.stderr.resume(); // Deliberately discard upstream diagnostics and private material.
    const rpc = new JsonRpcClient(session.child, () =>
        session.fail("protocol_failed"),
    );
    let initialized = false;
    const timeoutMs = duration(options.startupTimeoutMs, 35_000);
    void rpc
        .request(
            "initialize",
            {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "panas-transport", version: "0.1.0" },
            },
            timeoutMs,
        )
        .then((result) => {
            if (
                !result ||
                typeof result !== "object" ||
                !("protocolVersion" in result) ||
                result.protocolVersion !== "2025-11-25" ||
                !("capabilities" in result) ||
                !("serverInfo" in result)
            )
                throw new Error("Invalid MCP initialization");
            rpc.notify("notifications/initialized");
            initialized = true;
            session.markReady();
        })
        .catch(() => session.fail("startup_failed"));
    return {
        ready: session.ready,
        closed: session.closed,
        stop: session.stop,
        generationId: session.generationId,
        request(
            method: string,
            params?: unknown,
            requestOptions?: { timeoutMs?: number },
        ) {
            if (!initialized)
                return Promise.reject(new Error("MCPWire join is not ready"));
            return rpc.request(
                method,
                params,
                duration(requestOptions?.timeoutMs, 10_000),
            );
        },
    };
}
