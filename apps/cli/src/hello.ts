import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { enrollDemo, SetupError } from "./client-setup.js";
import { terminalText } from "./console.js";

/** One free request. Uncertainty is retrieved by request ID, never replayed. */
export async function helloWorld(cliPath: string, resumeRequestId?: string) {
    const { envPath } = await enrollDemo({
        home: homedir(),
        client: "terminal",
    });
    const client = new Client({ name: "panas-hello-world", version: "1" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cliPath, "buyer", "--env-file", envPath],
        stderr: "ignore",
    });
    const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool(
            { name, arguments: args },
            undefined,
            { timeout: 120000 },
        );
        if (result.isError)
            throw new SetupError(
                `Demo step ${name} could not complete. Retain the request ID and use get_request after uncertainty.`,
            );
        return z
            .record(z.string(), z.unknown())
            .parse(result.structuredContent);
    };
    try {
        await client.connect(transport);
        if (resumeRequestId) {
            z.uuid().parse(resumeRequestId);
            const state = await call("get_request", {
                requestId: resumeRequestId,
            });
            process.stdout.write(JSON.stringify(state) + "\n");
            if (!state.receipt || state.status !== "completed")
                process.exitCode = 1;
            return;
        }
        const found = await call("discover_providers", {
            model: "qwen2.5:0.5b",
            maxPriceAtomic: "0",
            readyOnly: true,
        });
        const providers = z
            .array(z.object({ providerId: z.uuid() }))
            .parse(found.providers);
        if (!providers.length)
            throw new SetupError(
                "No free device is ready right now. Try again when a provider is available.",
            );
        const providerId = providers[0]!.providerId;
        await call("get_provider", { providerId });
        const quoted = await call("quote_inference", {
            providerId,
            prompt: "Reply with a short Hello world greeting from Panas.",
            maxOutputTokens: 32,
        });
        const quote = z
            .object({
                quoteId: z.uuid(),
                requestId: z.uuid(),
                totalAtomic: z.literal("0"),
                providerAtomic: z.literal("0"),
                feeAtomic: z.literal("0"),
            })
            .parse(quoted);
        process.stderr.write(`Free demo request ${quote.requestId}\n`);
        await call("purchase_access", {
            quoteId: quote.quoteId,
            idempotencyKey: randomUUID(),
        });
        let state: Record<string, unknown> = {};
        try {
            state = await call("run_inference", { requestId: quote.requestId });
        } catch {
            /* Resolve the same request without sending inference again. */
        }
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline && !state.receipt) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            state = await call("get_request", { requestId: quote.requestId });
        }
        const receipt = z
            .object({
                buyerDebitAtomic: z.literal("0"),
                providerEarningsAtomic: z.literal("0"),
                feeAtomic: z.literal("0"),
                status: z.string(),
            })
            .safeParse(state.receipt);
        const result = z.object({ text: z.string() }).safeParse(state.result);
        process.stdout.write(
            JSON.stringify({
                providerId,
                model: "qwen2.5:0.5b",
                requestId: quote.requestId,
                status: state.status ?? "uncertain",
                text: result.success ? terminalText(result.data.text) : null,
                chargeAtomic: receipt.success ? "0" : null,
                receipt: receipt.success ? receipt.data : null,
            }) + "\n",
        );
        if (!receipt.success || receipt.data.status !== "completed")
            process.exitCode = 1;
    } finally {
        await client.close();
        await transport.close();
    }
}
