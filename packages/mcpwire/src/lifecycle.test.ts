import { afterEach, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    superviseShare,
    superviseJoin,
    probePeer,
    type LaunchCommand,
    type TransportEvent,
} from "./index";
const fixture = fileURLToPath(
    new URL("../test/fixtures/cli.mjs", import.meta.url),
);
const launch = (mode: string, args: string[] = []): LaunchCommand => ({
    command: process.execPath,
    args: [fixture, mode, ...args],
});
const sessions: { stop(): Promise<void> }[] = [];
afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.stop()));
});
it("captures split private config but sends no ticket or raw diagnostic to observers", async () => {
    const events: TransportEvent[] = [];
    const session = superviseShare({
        command: process.execPath,
        launch: launch("share"),
        onEvent: (event) => events.push(event),
        shutdownGraceMs: 10,
    });
    sessions.push(session);
    const outcome = await session.ready;
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ticket).toMatch(/^wire:\/\/[a-f0-9]{64}$/);
    expect(JSON.stringify(events)).not.toContain(outcome.ticket);
    expect(JSON.stringify(events)).not.toContain("UPSTREAM_SECRET");
    await session.stop();
    expect((await session.closed).kind).toBe("closed");
});
it("reports spawn failure, early exit, protocol failure, and bounded startup timeout without child output", async () => {
    for (const mode of ["fail", "timeout"]) {
        const session = superviseShare({
            command: process.execPath,
            launch: launch(mode),
            startupTimeoutMs: 150,
            shutdownGraceMs: 10,
        });
        sessions.push(session);
        const result = await session.ready;
        expect(result.kind).toBe(mode === "timeout" ? "timeout" : "failed");
        expect(JSON.stringify(result)).not.toContain("sensitive");
    }
    const missing = superviseShare({
        command: "ignored",
        launch: { command: "/nonexistent/panas-cli", args: [] },
        shutdownGraceMs: 10,
    });
    sessions.push(missing);
    expect((await missing.ready).kind).toBe("failed");
    const invalid = superviseJoin({
        ticket: `wire://${"a".repeat(64)}`,
        launch: launch("malformed"),
        shutdownGraceMs: 10,
    });
    sessions.push(invalid);
    expect((await invalid.ready).kind).toBe("failed");
});
it("bridges concurrent JSON-RPC responses and marks lost or timed-out requests uncertain without retry", async () => {
    const session = superviseJoin({
        ticket: `wire://${"a".repeat(64)}`,
        launch: launch("rpc"),
        shutdownGraceMs: 10,
    });
    sessions.push(session);
    expect((await session.ready).kind).toBe("ready");
    expect(
        await Promise.all([
            session.request("echo", { n: 1 }),
            session.request("echo", { n: 2 }),
        ]),
    ).toEqual([{ n: 1 }, { n: 2 }]);
    await expect(
        session.request("never", {}, { timeoutMs: 20 }),
    ).rejects.toMatchObject({
        code: "request_timeout",
        execution: "uncertain",
    });
    const disconnected = superviseJoin({
        ticket: `wire://${"b".repeat(64)}`,
        launch: launch("disconnect"),
        shutdownGraceMs: 10,
    });
    sessions.push(disconnected);
    await disconnected.ready;
    await expect(disconnected.request("tools/call", {})).rejects.toMatchObject({
        code: "disconnected",
        execution: "uncertain",
    });
});
it("kills descendants even when the share process exits before its child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "panas-tree-"));
    try {
        const path = join(dir, "pid");
        const session = superviseShare({
            command: process.execPath,
            launch: launch("tree", [path]),
            shutdownGraceMs: 100,
        });
        sessions.push(session);
        await session.ready;
        const pid = Number(readFileSync(path, "utf8"));
        await session.stop();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(() => process.kill(pid, 0)).toThrow();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
it("requires startup-bound separate-peer evidence and explicitly represents a missing probe", async () => {
    expect((await probePeer({ startupId: "current" })).status).toBe(
        "unverified",
    );
    const passed = await probePeer({
        startupId: "current",
        ticket: `wire://${"a".repeat(64)}`,
        launch: launch("rpc", ["current"]),
        shutdownGraceMs: 10,
    });
    expect(passed).toMatchObject({
        status: "verified",
        startupId: "current",
        evidence: "separate-process-local-peer",
    });
    expect(
        (
            await probePeer({
                startupId: "current",
                ticket: `wire://${"a".repeat(64)}`,
                launch: launch("wrong-startup"),
                shutdownGraceMs: 10,
            })
        ).status,
    ).toBe("failed");
});
it("requires an explicit new session for rotation and never reuses a prior ticket", async () => {
    const first = superviseShare({
        command: process.execPath,
        launch: launch("share"),
        shutdownGraceMs: 10,
    });
    sessions.push(first);
    const a = await first.ready;
    await first.stop();
    await first.closed;
    const second = superviseShare({
        command: process.execPath,
        launch: launch("share"),
        shutdownGraceMs: 10,
    });
    sessions.push(second);
    const b = await second.ready;
    expect(first.generationId).not.toBe(second.generationId);
    if (a.kind === "ready" && b.kind === "ready")
        expect(a.ticket).not.toBe(b.ticket);
});

it("aborts startup and does not run an application request on a replacement session", async () => {
    const controller = new AbortController();
    const events: TransportEvent[] = [];
    const session = superviseShare({
        command: process.execPath,
        launch: launch("timeout"),
        signal: controller.signal,
        shutdownGraceMs: 10,
        onEvent: (event) => events.push(event),
    });
    sessions.push(session);
    controller.abort();
    expect(await session.ready).toMatchObject({
        kind: "failed",
        code: "aborted",
    });
    await session.closed;
    expect(events.filter((event) => event.kind === "failed")).toHaveLength(1);
});

it("preserves the external CLI exit code across its owner guard", async () => {
    const session = superviseShare({
        command: "ignored",
        launch: { command: process.execPath, args: ["-e", "process.exit(17)"] },
        startupTimeoutMs: 1000,
        shutdownGraceMs: 10,
    });
    sessions.push(session);
    expect((await session.ready).kind).toBe("failed");
    expect(await session.closed).toMatchObject({ code: 17, signal: null });
});
