import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OllamaRuntime } from "./runtime.js";

async function fixture(startDelay = 0) {
    const directory = await mkdtemp(join(tmpdir(), "panas-runtime-lifecycle-"));
    const marker = join(directory, "started-pids");
    const binary = join(directory, "runtime.mjs");
    await writeFile(
        binary,
        `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import {createServer} from 'node:http';
appendFileSync(${JSON.stringify(marker)},String(process.pid)+'\\n');
const server=createServer((req,res)=>res.writeHead(200,{'content-type':'application/json'}).end('{"version":"fixture"}'));
const startup=setTimeout(()=>server.listen(Number(process.env.OLLAMA_HOST.split(':').at(-1)),'127.0.0.1'),${startDelay});
process.on('SIGTERM',()=>{clearTimeout(startup);server.closeAllConnections();server.close();process.exit(0);});
`,
        { mode: 0o700 },
    );
    const reservation = createServer();
    await new Promise<void>((resolve) =>
        reservation.listen(0, "127.0.0.1", resolve),
    );
    const address = reservation.address();
    if (!address || typeof address === "string")
        throw new Error("NO_TEST_PORT");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const endpoint = "http://127.0.0.1:" + address.port;
    const runtime = new OllamaRuntime({
        binary,
        modelsPath: directory,
        endpoint,
    });
    return {
        runtime,
        endpoint,
        marker,
        async cleanup() {
            await runtime.stop();
            await rm(directory, { recursive: true, force: true });
        },
    };
}

it("stop cancels startup before the asynchronous port check can create a detached process", async () => {
    const f = await fixture();
    try {
        const starting = f.runtime.start();
        const rejected = expect(starting).rejects.toThrow(/startup cancelled/);
        await f.runtime.stop();
        await rejected;
        await expect(readFile(f.marker, "utf8")).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(fetch(f.endpoint + "/api/version")).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});

it("stop during native startup rejects promptly and leaves no detached listener", async () => {
    const f = await fixture(10000);
    try {
        const starting = f.runtime.start();
        const rejected = expect(starting).rejects.toThrow(
            /startup cancelled|failed to start/,
        );
        let pid = 0;
        for (let i = 0; i < 100; i++) {
            try {
                pid = Number((await readFile(f.marker, "utf8")).trim());
                break;
            } catch {
                await delay(20);
            }
        }
        expect(pid).toBeGreaterThan(0);
        await f.runtime.stop();
        await rejected;
        expect(() => process.kill(pid, 0)).toThrow();
        await expect(fetch(f.endpoint + "/api/version")).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
}, 10000);

it("normal stop permits retesting, while final host shutdown prevents later capability stages from restarting", async () => {
    const f = await fixture();
    try {
        await f.runtime.start();
        await f.runtime.stop();
        await f.runtime.start();
        expect((await fetch(f.endpoint + "/api/version")).status).toBe(200);
        f.runtime.beginShutdown();
        await f.runtime.stop();
        await expect(f.runtime.start()).rejects.toThrow(/shutting down/);
        expect(
            (await readFile(f.marker, "utf8")).trim().split("\n"),
        ).toHaveLength(2);
        await expect(fetch(f.endpoint + "/api/version")).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
}, 10000);
