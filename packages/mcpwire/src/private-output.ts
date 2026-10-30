import { validateTicket, MCPWIRE_VERSION } from "./commands";

/** Parser for the pinned 1.1.1 non-TTY stderr config. Never returns raw output. */
export class PrivateShareParser {
    private buffer = "";
    private listening = false;
    private bytes = 0;
    feed(chunk: string): string | undefined {
        this.bytes += Buffer.byteLength(chunk);
        if (this.bytes > 65_536)
            throw new Error("MCPWire readiness output exceeded limit");
        this.buffer += chunk;
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (
                line.startsWith(`MCPWire v${MCPWIRE_VERSION} ·`) &&
                line.endsWith("· Listening")
            )
                this.listening = true;
            if (!this.listening || !line.startsWith('"args":')) continue;
            const args: unknown = JSON.parse(line.slice(7).replace(/,$/, ""));
            if (
                Array.isArray(args) &&
                args.length === 4 &&
                args[0] === "-y" &&
                args[1] === "@mcpwire/cli" &&
                args[2] === "join" &&
                typeof args[3] === "string"
            )
                return validateTicket(args[3]);
        }
        return undefined;
    }
}
