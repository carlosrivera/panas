import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { useEffect, useState } from "react";
import { Box, Text, render, useInput } from "ink";

const colors = {
    accent: "#C5F74F",
    text: "#EDEDE6",
    muted: "#A3A39A",
    border: "#55554F",
    ink: "#131311",
    error: "#F29B8F",
};
export type DemoClient = "codex" | "antigravity";
export const terminalText = (value: string) =>
    Array.from(stripVTControlCharacters(value))
        .filter((character) => {
            const code = character.codePointAt(0)!;
            return (
                character === "\n" ||
                (code >= 32 &&
                    code !== 127 &&
                    !(code >= 0x202a && code <= 0x202e) &&
                    !(code >= 0x2066 && code <= 0x2069))
            );
        })
        .join("");

export class ConsoleModel extends EventEmitter {
    phase = "Preparing your provider";
    detail = "Checking local configuration.";
    events: string[] = [];
    ready = false;
    lastStatusAt = 0;
    stopping = false;
    failed = false;
    client: DemoClient = "codex";
    readonly startedAt = Date.now();
    constructor(
        readonly options: {
            version: string;
            mode: "provider" | "demo";
            prompt?: (client: DemoClient) => string;
            providerId?: string;
            price?: string;
        },
    ) {
        super();
    }
    update() {
        this.emit("change");
    }
    progress(phase: string, detail: string) {
        if (this.stopping) return;
        this.phase = terminalText(phase);
        this.detail = terminalText(detail);
        this.log(phase);
    }
    log(message: string) {
        this.events.push(
            `${new Date().toTimeString().slice(0, 8)}  ${terminalText(message)}`,
        );
        this.events = this.events.slice(-200);
        this.update();
    }
    get prompt() {
        return this.options.prompt?.(this.client) ?? "";
    }
}

export async function copyToClipboard(text: string) {
    const [command, args] =
        process.platform === "darwin"
            ? (["pbcopy", []] as const)
            : process.env.WAYLAND_DISPLAY
              ? (["wl-copy", []] as const)
              : (["xclip", ["-selection", "clipboard"]] as const);
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args], {
            stdio: ["pipe", "ignore", "ignore"],
        });
        child.once("error", reject);
        child.stdin.once("error", reject);
        child.once("close", (code) =>
            code === 0 ? resolve() : reject(new Error("Clipboard unavailable")),
        );
        child.stdin.end(text);
    });
}

export function PanasConsole({
    model,
    onQuit,
    output = process.stderr,
    copy = copyToClipboard,
}: {
    model: ConsoleModel;
    onQuit: () => void;
    output?: EventEmitter & { columns: number; rows: number };
    copy?: (text: string) => Promise<void>;
}) {
    const [, refresh] = useState(0);
    const [tab, setTab] = useState<"overview" | "activity">("overview");
    const [offset, setOffset] = useState(0);
    const [notice, setNotice] = useState("");
    const [size, setSize] = useState({
        columns: output.columns || 80,
        rows: output.rows || 24,
    });
    useEffect(() => {
        const update = () => refresh((n) => n + 1);
        const resize = () =>
            setSize({ columns: output.columns || 80, rows: output.rows || 24 });
        model.on("change", update);
        output.on("resize", resize);
        const timer = setInterval(update, 1000);
        return () => {
            model.off("change", update);
            output.off("resize", resize);
            clearInterval(timer);
        };
    }, [model, output]);
    const demo = model.options.mode === "demo";
    const publicProviderId =
        /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            model.options.providerId ?? "",
        )
            ? model.options.providerId
            : undefined;
    const fresh =
        model.ready &&
        Date.now() - model.lastStatusAt < 6500 &&
        !model.stopping;
    useInput((input, key) => {
        if (input === "q" || (key.ctrl && input === "c")) {
            onQuit();
            return;
        }
        if (model.stopping) return;
        if (key.tab) {
            setTab((t) => (t === "overview" ? "activity" : "overview"));
            setOffset(0);
        }
        if (key.upArrow) setOffset((n) => Math.max(0, n - 1));
        if (key.downArrow) setOffset((n) => n + 1);
        if (demo && (input === "1" || input === "2")) {
            model.client = input === "1" ? "codex" : "antigravity";
            setNotice("");
            setOffset(0);
            model.update();
        }
        if (input === "c") {
            if (!demo && !publicProviderId) {
                setNotice("The public provider identity is not available yet.");
                return;
            }
            void copy(
                demo
                    ? model.prompt
                    : `https://panas.mcpwire.co/providers/detail/?id=${publicProviderId}`,
            )
                .then(() =>
                    setNotice(
                        demo
                            ? "Prompt copied. Paste it into your agent."
                            : "Public provider link copied.",
                    ),
                )
                .catch(() =>
                    setNotice(
                        "Clipboard unavailable. Use --plain to select and copy the text.",
                    ),
                );
        }
    });
    const title = demo ? "Buyer demo" : "Share your Mac";
    const indicator = model.stopping
        ? "Stopping safely"
        : model.failed
          ? "Needs attention"
          : demo
            ? "Free inference only"
            : fresh
              ? model.phase
              : model.ready
                ? "Checking connection"
                : model.phase;
    const width = Math.max(1, size.columns - 6);
    const content =
        tab === "activity"
            ? model.events.length
                ? model.events
                : ["No requests have been sent by this screen."]
            : demo
              ? model.prompt.split("\n")
              : [
                    model.ready && !fresh ? "Checking connection" : model.phase,
                    "",
                    model.detail,
                    "",
                    `Model     qwen2.5:0.5b · offline CPU worker`,
                    `Access    ${model.options.price ?? "Free"}`,
                    `Provider  ${publicProviderId ?? "Checking identity"}`,
                    "",
                    "Local checks and an independent peer probe must pass before sharing.",
                    "Prompts and connection tickets are never shown here.",
                ];
    const lines = content.flatMap((line) => {
        const chars = Array.from(terminalText(line));
        return Array.from(
            { length: Math.max(1, Math.ceil(chars.length / width)) },
            (_, i) => chars.slice(i * width, (i + 1) * width).join(""),
        );
    });
    const compactActions = size.columns < 56;
    const height = Math.max(
        1,
        size.rows - (demo ? (compactActions ? 14 : 13) : 11),
    );
    const copyButton = (
        <Text bold backgroundColor={colors.accent} color={colors.ink}>
            {" c COPY PROMPT "}
        </Text>
    );
    const start = Math.min(offset, Math.max(0, lines.length - height));
    if (size.columns < 36 || size.rows < 16)
        return (
            <Box flexDirection="column" width={size.columns}>
                <Text bold color={colors.accent}>
                    panas · {title}
                </Text>
                <Text wrap="truncate">{indicator}</Text>
                <Text wrap="truncate">
                    Enlarge terminal · c copy {demo ? "prompt" : "link"} · q{" "}
                    {demo ? "done" : "stop"}
                </Text>
            </Box>
        );
    return (
        <Box
            flexDirection="column"
            width={size.columns}
            height={size.rows - 1}
            paddingX={1}
        >
            <Box
                justifyContent="space-between"
                height={1}
                flexShrink={0}
                overflow="hidden"
            >
                <Text bold color={colors.accent}>
                    panas{" "}
                    <Text color={colors.muted}>
                        v{terminalText(model.options.version)}
                    </Text>
                </Text>
                <Text color={model.failed ? colors.error : colors.accent}>
                    {fresh ? "●" : "◌"} {indicator}
                </Text>
            </Box>
            <Text bold color={colors.text} wrap="truncate">
                {title}{" "}
                <Text color={colors.muted}>
                    {" "}
                    / spare compute, between panas.
                </Text>
            </Text>
            <Text color={colors.muted} wrap="truncate">
                {demo
                    ? "Set up MCP, find a free device, send Hello world."
                    : "Docker gateway + network-disabled inference worker"}
            </Text>
            {demo ? (
                <>
                    <Box marginTop={1} gap={2} height={1} flexShrink={0}>
                        <Text
                            color={
                                model.client === "codex"
                                    ? colors.accent
                                    : colors.muted
                            }
                        >
                            1 Codex
                        </Text>
                        <Text
                            color={
                                model.client === "antigravity"
                                    ? colors.accent
                                    : colors.muted
                            }
                        >
                            2 Antigravity
                        </Text>
                        {!compactActions && copyButton}
                    </Box>
                    {compactActions && (
                        <Box height={1} flexShrink={0}>
                            {copyButton}
                        </Box>
                    )}
                    <Text bold color={colors.text} wrap="truncate">
                        COPY THIS PROMPT → paste into{" "}
                        {model.client === "codex" ? "Codex" : "Antigravity"}
                    </Text>
                </>
            ) : (
                <Text color={colors.muted} wrap="truncate">
                    Uptime {Math.floor((Date.now() - model.startedAt) / 60000)}m
                    · one bounded inference at a time
                </Text>
            )}
            <Box
                marginTop={1}
                gap={3}
                height={1}
                flexShrink={0}
                overflow="hidden"
            >
                <Text
                    bold
                    color={tab === "overview" ? colors.accent : colors.muted}
                >
                    {demo ? "Prompt" : "Overview"}
                </Text>
                <Text
                    bold
                    color={tab === "activity" ? colors.accent : colors.muted}
                >
                    Activity
                </Text>
                <Text color={colors.muted}>
                    {lines.length > height
                        ? `↑/↓ scroll · ${start + 1}/${lines.length}`
                        : ""}
                </Text>
            </Box>
            <Box
                flexDirection="column"
                borderStyle="single"
                borderLeft={false}
                borderRight={false}
                borderColor={colors.border}
                flexGrow={1}
                overflow="hidden"
                paddingX={1}
            >
                {lines.slice(start, start + height).map((line, index) => (
                    <Text key={index} color={colors.text} wrap="truncate">
                        {line || " "}
                    </Text>
                ))}
            </Box>
            <Text color={colors.accent} wrap="truncate">
                {notice ||
                    (demo
                        ? "Nothing has been sent yet. Your agent will perform the demo."
                        : model.detail)}
            </Text>
            <Text color={colors.muted} wrap="truncate">
                {demo ? "1/2 choose agent · " : ""}c copy{" "}
                {demo ? "prompt" : "public link"} · tab switch · ↑/↓ scroll · q{" "}
                {demo ? "done" : "stop"}
            </Text>
        </Box>
    );
}

export function startConsole(model: ConsoleModel, onQuit: () => void) {
    process.stderr.write("\x1b[?1049h");
    const app = render(<PanasConsole model={model} onQuit={onQuit} />, {
        stdout: process.stderr,
        stderr: process.stderr,
        stdin: process.stdin,
        exitOnCtrlC: false,
        patchConsole: false,
    });
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        app.unmount();
        process.stderr.write("\x1b[?1049l");
        process.off("exit", stop);
    };
    process.once("exit", stop);
    return { stop };
}
