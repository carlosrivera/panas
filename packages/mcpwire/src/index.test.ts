import { expect, it } from "vitest";
import { joinArgs, shareArgs, startMcpwire } from "./index";
it("rejects malformed or shell-appended tickets", () => {
    for (const ticket of [
        "wire://bad",
        `wire://${"a".repeat(64)}; echo bad`,
        `wire://${"a".repeat(64)}\n`,
    ])
        expect(() => joinArgs(ticket)).toThrow();
});
it("keeps executable arguments separate and exposes only the provider tools", () => {
    const args = shareArgs("/path with spaces/node", ["literal;argument"]);
    expect(args.slice(-2)).toEqual([
        "/path with spaces/node",
        "literal;argument",
    ]);
    expect(args).not.toContain("--record");
    expect(args[args.indexOf("--allow") + 1]).toBe(
        "get_capabilities,run_inference,get_request,cancel_request",
    );
});

it("can launch the pinned external CLI through its public binary", async () => {
    const child = startMcpwire(["--help"]);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    const result = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
    });
    expect(result).toBe(0);
    expect(output).toContain("share");
}, 10000);
