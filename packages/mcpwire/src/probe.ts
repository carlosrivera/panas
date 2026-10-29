import { superviseJoin, type SessionOptions } from "./lifecycle";
export interface PeerProbeResult {
    status: "verified" | "unverified" | "failed";
    startupId: string;
    testedAt: string;
    detail: string;
    evidence: "separate-process-local-peer" | "not-run";
}
export async function probePeer(
    options: SessionOptions & {
        ticket?: string;
        startupId: string;
        timeoutMs?: number;
    },
): Promise<PeerProbeResult> {
    const base = {
        startupId: options.startupId,
        testedAt: new Date().toISOString(),
    };
    if (!options.ticket)
        return {
            ...base,
            status: "unverified",
            evidence: "not-run",
            detail: "No separate peer probe configured",
        };
    let session: ReturnType<typeof superviseJoin> | undefined;
    const deadline = Date.now() + (options.timeoutMs ?? 35_000);
    try {
        session = superviseJoin({
            ...options,
            ticket: options.ticket,
            startupTimeoutMs: options.timeoutMs ?? 35_000,
        });
        const ready = await session.ready;
        if (ready.kind !== "ready")
            return {
                ...base,
                status: "failed",
                evidence: "separate-process-local-peer",
                detail: `Peer initialization ${ready.kind}`,
            };
        const result = await session.request(
            "tools/call",
            { name: "get_capabilities", arguments: {} },
            { timeoutMs: Math.max(1, deadline - Date.now()) },
        );
        const content =
            result &&
            typeof result === "object" &&
            !("isError" in result && result.isError) &&
            "structuredContent" in result
                ? result.structuredContent
                : undefined;
        if (
            !content ||
            typeof content !== "object" ||
            !("startupId" in content) ||
            content.startupId !== options.startupId
        )
            return {
                ...base,
                status: "failed",
                evidence: "separate-process-local-peer",
                detail: "Probe did not return the expected startup identity",
            };
        return {
            ...base,
            status: "verified",
            evidence: "separate-process-local-peer",
            detail: "Separate local peer completed MCP capability round trip; remote-network reachability is not established",
        };
    } catch {
        return {
            ...base,
            status: "failed",
            evidence: "separate-process-local-peer",
            detail: "Peer round trip failed; no request was replayed",
        };
    } finally {
        await session?.stop();
    }
}
