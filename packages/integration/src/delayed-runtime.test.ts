import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { prepareDelayedRuntime } from "./delayed-runtime.js";

async function port() {
    const server = createServer();
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("NO_TEST_PORT");
    await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    );
    return address.port;
}

it("delays only completed generation transport, keeps health live, and stops its owned upstream", async () => {
    const directory = await mkdtemp(join(tmpdir(), "panas-delay-test-"));
    const binary = join(directory, "native-fixture.mjs");
    await writeFile(
        binary,
        `#!/usr/bin/env node
import {createServer} from 'node:http';
if(process.argv[2]==='--version') { console.log('fixture-version'); process.exit(0); }
const port=Number(process.env.OLLAMA_HOST.split(':').at(-1));
const server=createServer(async(req,res)=>{
 const chunks=[]; for await(const c of req)chunks.push(c);
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({nativePath:req.url,body:Buffer.concat(chunks).toString(),pid:process.pid}));
});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
`,
        { mode: 0o700 },
    );
    const externalPort = await port(),
        upstreamPort = await port();
    const wrapper = await prepareDelayedRuntime({
        privateDir: directory,
        binary,
        externalPort,
        upstreamPort,
    });
    const child = spawn(wrapper.binaryPath, ["serve"], {
        detached: true,
        stdio: "ignore",
    });
    const endpoint = "http://127.0.0.1:" + externalPort;
    const waitReady = async () => {
        for (let i = 0; i < 100; i++) {
            try {
                const response = await fetch(endpoint + "/api/version", {
                    signal: AbortSignal.timeout(500),
                });
                if (response.ok)
                    return (await response.json()) as { pid: number };
            } catch {
                /* Owned startup only. */
            }
            await delay(25);
        }
        throw new Error("WRAPPER_NOT_READY");
    };
    try {
        const native = await waitReady();
        await wrapper.setHoldGenerate(true);
        let finished = false;
        const result = fetch(endpoint + "/api/generate", {
            method: "POST",
            body: '{"prompt":"fixture-only"}',
        }).then(async (response) => {
            finished = true;
            return response.json() as Promise<{
                nativePath: string;
                body: string;
            }>;
        });
        await delay(100);
        expect(finished).toBe(false);
        expect(await wrapper.snapshot()).toMatchObject({
            nativeGenerationsCompleted: 1,
            heldGenerations: 1,
        });
        expect((await fetch(endpoint + "/api/tags")).status).toBe(200);
        await wrapper.setHoldGenerate(false);
        expect(await result).toMatchObject({
            nativePath: "/api/generate",
            body: '{"prompt":"fixture-only"}',
        });
        await wrapper.setHoldGenerate(true);
        const abort = new AbortController();
        const aborted = fetch(endpoint + "/api/generate", {
            method: "POST",
            body: "{}",
            signal: abort.signal,
        });
        await delay(50);
        abort.abort();
        await expect(aborted).rejects.toThrow();
        expect((await fetch(endpoint + "/api/version")).status).toBe(200);
        await wrapper.close();
        expect(() => process.kill(native.pid, 0)).toThrow();
        await expect(
            fetch("http://127.0.0.1:" + upstreamPort + "/api/version"),
        ).rejects.toThrow();
    } finally {
        await wrapper.close().catch(() => {});
        if (child.pid && child.exitCode === null && child.signalCode === null) {
            try {
                process.kill(-child.pid, "SIGKILL");
            } catch {
                /* Already stopped. */
            }
        }
        await rm(directory, { recursive: true, force: true });
    }
}, 15000);

it("refuses to adopt or stop an existing upstream listener", async () => {
    const directory = await mkdtemp(join(tmpdir(), "panas-delay-occupied-"));
    const occupied = createServer((socket) => socket.end());
    await new Promise<void>((resolve) =>
        occupied.listen(0, "127.0.0.1", resolve),
    );
    const address = occupied.address();
    if (!address || typeof address === "string")
        throw new Error("NO_TEST_PORT");
    const wrapper = await prepareDelayedRuntime({
        privateDir: directory,
        binary: process.execPath,
        externalPort: await port(),
        upstreamPort: address.port,
    });
    const child = spawn(wrapper.binaryPath, ["serve"], { stdio: "ignore" });
    try {
        const code = await new Promise((resolve) =>
            child.once("exit", resolve),
        );
        expect(code).toBe(65);
        expect(occupied.listening).toBe(true);
    } finally {
        await new Promise<void>((resolve) => occupied.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
}, 10000);
