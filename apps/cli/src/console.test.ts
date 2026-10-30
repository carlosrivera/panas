import { createElement } from "react";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { render } from "ink-testing-library";
import { expect, it, vi } from "vitest";
import { prototypeLimits } from "@panas/contracts";
import { requiredCapabilityChecks } from "@panas/contracts/provider";
import { ConsoleModel, PanasConsole, terminalText } from "./console.js";
import { observeProvider } from "./provider-observation.js";

it("makes the exact buyer prompt copyable, switches clients, scrolls and handles terminal resizing", async () => {
    const model = new ConsoleModel({
        version: "test",
        mode: "demo",
        prompt: (client) =>
            `${client}: Hello world\n${"setup safely and preserve existing settings. ".repeat(100)}`,
    });
    const output = Object.assign(new EventEmitter(), { columns: 80, rows: 26 });
    const copy = vi.fn(async (_text: string) => {});
    const quit = vi.fn();
    const app = render(
        createElement(PanasConsole, { model, output, copy, onQuit: quit }),
    );
    try {
        await vi.waitFor(() =>
            expect(model.listenerCount("change")).toBeGreaterThan(0),
        );
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("COPY THIS PROMPT"),
        );
        expect(app.lastFrame()!.split("\n")[0]).toContain("panas");
        expect(app.lastFrame()).toContain("c COPY PROMPT");
        expect(app.lastFrame()).toContain("1 Codex");
        expect(app.lastFrame()).toContain("2 Antigravity");
        app.stdin.write("c");
        await vi.waitFor(() =>
            expect(copy).toHaveBeenLastCalledWith(model.prompt),
        );
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("Prompt copied"),
        );
        app.stdin.write("2");
        await vi.waitFor(() => expect(model.client).toBe("antigravity"));
        app.stdin.write("c");
        await vi.waitFor(() =>
            expect(copy).toHaveBeenLastCalledWith(model.prompt),
        );
        expect(copy.mock.calls[1]![0]).toContain("antigravity: Hello world");
        app.stdin.write("\x1b[B");
        await vi.waitFor(() =>
            expect(app.lastFrame()).not.toContain("antigravity: Hello world"),
        );
        output.columns = 40;
        output.rows = 20;
        output.emit("resize");
        await vi.waitFor(() =>
            expect(
                app
                    .lastFrame()!
                    .split("\n")
                    .every((line) => Array.from(line).length <= 40),
            ).toBe(true),
        );
        expect(app.lastFrame()!.split("\n")[0]).toContain("panas");
        expect(app.lastFrame()).toContain("c COPY PROMPT");
        output.columns = 25;
        output.rows = 10;
        output.emit("resize");
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("Enlarge terminal"),
        );
        app.stdin.write("q");
        await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    } finally {
        app.unmount();
        app.cleanup();
    }
});

it("gives usable clipboard failure feedback without printing caught errors", async () => {
    const model = new ConsoleModel({
        version: "test",
        mode: "demo",
        prompt: () => "Hello world",
    });
    const app = render(
        createElement(PanasConsole, {
            model,
            onQuit: () => {},
            copy: async () => {
                throw new Error("private fixture credential");
            },
        }),
    );
    try {
        await vi.waitFor(() =>
            expect(model.listenerCount("change")).toBeGreaterThan(0),
        );
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("COPY THIS PROMPT"),
        );
        app.stdin.write("c");
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("Clipboard unavailable"),
        );
        expect(app.lastFrame()).not.toContain("private fixture");
    } finally {
        app.unmount();
        app.cleanup();
    }
});

it("expires the visible ready state and never copies invalid provider identity material", async () => {
    const model = new ConsoleModel({
        version: "test",
        mode: "provider",
        providerId: "wire://private-fixture",
    });
    model.ready = true;
    model.phase = "Ready to share";
    model.lastStatusAt = Date.now() - 7000;
    const copy = vi.fn(async (_text: string) => {});
    const app = render(
        createElement(PanasConsole, { model, copy, onQuit: () => {} }),
    );
    try {
        await vi.waitFor(() =>
            expect(model.listenerCount("change")).toBeGreaterThan(0),
        );
        expect(app.lastFrame()).toContain("Checking connection");
        expect(app.lastFrame()).not.toContain("Ready to share");
        expect(app.lastFrame()).not.toContain("private-fixture");
        app.stdin.write("c");
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain(
                "public provider identity is not available",
            ),
        );
        expect(copy).not.toHaveBeenCalled();
        model.options.providerId = randomUUID();
        model.lastStatusAt = Date.now();
        model.update();
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("Ready to share"),
        );
        model.stopping = true;
        model.update();
        await vi.waitFor(() =>
            expect(app.lastFrame()).toContain("Stopping safely"),
        );
        expect(app.lastFrame()).not.toContain("Ready to share");
    } finally {
        app.unmount();
        app.cleanup();
    }
});

it("only advertises ready after verified checks and a matching provider report", () => {
    const id = randomUUID();
    const model = new ConsoleModel({
        version: "test",
        mode: "provider",
        providerId: id,
    });
    const report = {
        schemaVersion: 1,
        providerId: id,
        startupId: randomUUID(),
        sequence: 1,
        testedAt: new Date().toISOString(),
        platform: "linux",
        architecture: "arm64",
        memoryBytes: 8 * 1024 ** 3,
        freeDiskBytes: 4 * 1024 ** 3,
        model: {
            name: "qwen2.5:0.5b",
            digest: "a".repeat(64),
            runtimeVersion: "0.40.12",
        },
        profile: prototypeLimits,
        checks: requiredCapabilityChecks.map((name) => ({
            name,
            passed: true,
            detail: "wire://private-fixture",
        })),
        peerProbe: { status: "verified", testedAt: new Date().toISOString() },
        benchmark: { warmLatencyMs: 150, tokensPerSecond: 20 },
        state: "ready",
    };
    expect(
        observeProvider(model, { ...report, ticket: "must-not-escape" }),
    ).toBe(false);
    expect(
        observeProvider(model, { ...report, providerId: randomUUID() }),
    ).toBe(false);
    expect(model.ready).toBe(false);
    expect(
        observeProvider(model, {
            ...report,
            peerProbe: { status: "unverified" },
        }),
    ).toBe(true);
    expect(model.ready).toBe(false);
    expect(observeProvider(model, report)).toBe(true);
    expect(model.ready).toBe(true);
    expect(model.phase).toBe("Ready to share");
    expect(
        JSON.stringify({ detail: model.detail, events: model.events }),
    ).not.toContain("private-fixture");
    observeProvider(model, { ...report, state: "draining" });
    expect(model.ready).toBe(false);
    expect(model.phase).toBe("Waiting for the registry");
});

it("removes terminal escape, clipboard and bidi sequences from presentation text", () => {
    expect(terminalText("\x1b[2Jhello\x1b]52;c;YQ==\x07\r\u202eworld")).toBe(
        "helloworld",
    );
    const model = new ConsoleModel({ version: "test", mode: "provider" });
    for (let i = 0; i < 250; i++) model.log(`event ${i}`);
    expect(model.events).toHaveLength(200);
});
