import {
    peerAddressSchema,
    peerAddressesSchema,
    type PeerAddress,
} from "@panas/contracts";
export const MCPWIRE_VERSION = "1.1.2";
const ticketPattern = /^wire:\/\/[a-fA-F0-9]{64}$/;
export function validateTicket(ticket: string): string {
    if (!ticketPattern.test(ticket)) throw new Error("Invalid MCPWire ticket");
    return ticket;
}
export function joinArgs(
    ticket: string,
    peerAddresses: PeerAddress[] = [],
): string[] {
    return [
        "join",
        validateTicket(ticket),
        ...peerAddressesSchema
            .parse(peerAddresses)
            .flatMap(({ host, port }) => ["--peer-address", `${host}:${port}`]),
    ];
}
export function shareArgs(
    command: string,
    args: string[] = [],
    port?: number,
): string[] {
    if (port !== undefined) peerAddressSchema.shape.port.parse(port);
    if (!command || command.startsWith("-"))
        throw new Error("Expected an executable path");
    return [
        "share",
        ...(port === undefined ? [] : ["--port", String(port)]),
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
