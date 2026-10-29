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
