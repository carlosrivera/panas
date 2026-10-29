import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

export const MCPWIRE_VERSION = "1.1.0";
const ticketPattern = /^wire:\/\/[a-fA-F0-9]{64}$/;
export function validateTicket(ticket: string): string {
    if (!ticketPattern.test(ticket)) throw new Error("Invalid MCPWire ticket");
    return ticket;
}
export function joinArgs(ticket: string): string[] {
    return ["join", validateTicket(ticket)];
}
export function shareArgs(command: string, args: string[] = []): string[] {
    if (!command || command.startsWith("-"))
        throw new Error("Expected an executable path");
    return [
        "share",
        "--name",
        "panas-provider",
        "--allow",
        "get_capabilities,run_inference,get_request,cancel_request",
        "--ttl",
        "1h",
        "--",
        command,
        ...args,
    ];
}
export function startMcpwire(args: string[]) {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("@mcpwire/cli/package.json"));
    return spawn(process.execPath, [join(root, "dist/index.js"), ...args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
    });
}
