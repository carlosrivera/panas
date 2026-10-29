import { launchCli } from "./lifecycle";

export {
    MCPWIRE_VERSION,
    validateTicket,
    joinArgs,
    shareArgs,
} from "./commands";
export function startMcpwire(args: string[]) {
    return launchCli(args);
}
export { superviseShare, superviseJoin, cliCommand } from "./lifecycle";
export type {
    LaunchCommand,
    SessionOptions,
    TransportEvent,
    StartupOutcome,
} from "./lifecycle";
export { probePeer } from "./probe";
export type { PeerProbeResult } from "./probe";
export { TransportRequestError } from "./rpc";
