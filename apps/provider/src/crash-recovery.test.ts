import { expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
    lstat,
    symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { EncryptedStore } from "./store.js";
import { claimProviderHost, waitForPreviousRuntime } from "./ownership.js";

async function waitFor(test: () => Promise<boolean>, ms = 5000) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
        if (await test()) return;
        await delay(20);
    }
    throw new Error("FIXTURE_WAIT_TIMEOUT");
}
async function exit(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([
        once(child, "exit"),
        delay(5000).then(() => {
            throw new Error("FIXTURE_EXIT_TIMEOUT");
        }),
    ]);
}
function alive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

it.skipIf(process.platform === "win32")(
    "recovers after a killed owner, stops its native group, and preserves encrypted keys, results and nonce records",
    async () => {
        const directory = await mkdtemp(join(tmpdir(), "panas-crash-"));
        const state = join(directory, "state");
        await mkdir(state, { mode: 0o700 });
        const marker = join(directory, "native.pid"),
            binary = join(directory, "native.mjs"),
            host = join(directory, "host.mts");
        const wireMarker = join(directory, "wire.pid"),
            wireBinary = join(directory, "wire.mjs");
        await writeFile(
            wireBinary,
            `import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(wireMarker)},JSON.stringify({pid:process.pid}));
process.stdin.on('data',data=>{if(data.toString().includes('PROBE'))process.stdout.write('STDIO_OK\\n');});
process.stdout.write('WIRE_READY\\n');setInterval(()=>{},1000);`,
        );
        const running = randomUUID(),
            completed = randomUUID(),
            nonce = randomUUID();
        await writeFile(
            binary,
            `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';import {createServer} from 'node:http';
process.on('SIGTERM',()=>{});
writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,guardian:process.ppid}));
createServer((req,res)=>res.writeHead(200,{'content-type':'application/json'}).end('{"version":"fixture"}')).listen(Number(process.env.OLLAMA_HOST.split(':').at(-1)),'127.0.0.1');
`,
            { mode: 0o700 },
        );
        const reservation = createServer();
        reservation.listen(0, "127.0.0.1");
        await once(reservation, "listening");
        const address = reservation.address();
        if (!address || typeof address === "string")
            throw new Error("NO_FIXTURE_PORT");
        await new Promise<void>((resolve) =>
            reservation.close(() => resolve()),
        );
        const endpoint = `http://127.0.0.1:${address.port}`;
        const moduleUrl = (name: string) => new URL(name, import.meta.url).href;
        await writeFile(
            host,
            `
import {claimProviderHost,waitForPreviousRuntime} from ${JSON.stringify(moduleUrl("./ownership.ts"))};
import {OllamaRuntime} from ${JSON.stringify(moduleUrl("./runtime.ts"))};
import {EncryptedStore} from ${JSON.stringify(moduleUrl("./store.ts"))};
import {serveLocal} from ${JSON.stringify(moduleUrl("./ipc.ts"))};
import {launchCli} from ${JSON.stringify(moduleUrl("../../../packages/mcpwire/src/lifecycle.ts"))};
const dir=${JSON.stringify(state)};
try {
 const ownership=await claimProviderHost(dir);
 const runtime=new OllamaRuntime({binary:${JSON.stringify(binary)},modelsPath:dir,endpoint:${JSON.stringify(endpoint)}});
 if(ownership.recovered)await waitForPreviousRuntime(runtime.url);
 const store=new EncryptedStore(dir+'/requests'),nonces=new EncryptedStore(dir+'/nonces');
 await store.init();await store.recoverAndCleanup();await nonces.init();await nonces.recoverAndCleanup();
 if(!ownership.recovered) {
 const base={buyerKeyId:'fixture-buyer',fingerprint:'fixture',updatedAt:Date.now()};
 await store.save({...base,requestId:${JSON.stringify(running)},status:'running'});
 await store.save({...base,requestId:${JSON.stringify(completed)},status:'completed',result:{text:'fixture result',inputTokens:1,outputTokens:1,durationMs:1},terminalEvent:{fixture:true},terminalDelivered:false});
 await nonces.save({...base,requestId:${JSON.stringify(nonce)},status:'completed'});
 }
 await runtime.start();
 const wire=launchCli([],{command:process.execPath,args:[${JSON.stringify(wireBinary)}]});
 await new Promise((resolve,reject)=>{let output='';wire.stdout.on('data',data=>{output+=data.toString();if(output.includes('WIRE_READY') && output.includes('STDIO_OK'))resolve();});wire.once('error',reject);wire.stdin.write('PROBE\\n');});
 const server=await serveLocal({},dir+'/daemon.sock','fixture-token');
 process.once('SIGTERM',()=>{runtime.beginShutdown();server.close();const wireClosed=new Promise(resolve=>wire.once('exit',resolve));wire.kill('SIGTERM');void Promise.all([runtime.stop(),wireClosed]).then(()=>process.exit(0));});
 console.log('READY');
} catch(error) {console.error(error.message);process.exitCode=1;}
`,
        );
        const children: ChildProcess[] = [];
        function launch() {
            const child = spawn(process.execPath, ["--import", "tsx", host], {
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    TMPDIR: process.env.TMPDIR,
                },
            });
            children.push(child);
            let output = "";
            child.stdout!.on("data", (chunk) => {
                output += chunk.toString();
            });
            let error = "";
            child.stderr!.on("data", (chunk) => {
                error += chunk.toString();
            });
            return {
                child,
                ready: () => waitFor(async () => output.includes("READY")),
                error: () => error,
            };
        }
        const nativePids: number[] = [];
        try {
            const first = launch();
            await first.ready();
            const firstNative = JSON.parse(await readFile(marker, "utf8")) as {
                pid: number;
            };
            const firstWire = JSON.parse(
                await readFile(wireMarker, "utf8"),
            ) as { pid: number };
            nativePids.push(firstNative.pid, firstWire.pid);
            const snapshot = await Promise.all(
                [
                    "requests/key",
                    `requests/${running}.enc`,
                    `requests/${completed}.enc`,
                    "nonces/key",
                    `nonces/${nonce}.enc`,
                ].map((path) => readFile(join(state, path))),
            );
            const contender = launch();
            await exit(contender.child);
            expect(contender.child.exitCode).toBe(1);
            expect(contender.error()).toContain(
                "PROVIDER_HOST_ALREADY_RUNNING",
            );
            expect(
                await readFile(join(state, "requests", running + ".enc")),
            ).toEqual(snapshot[1]);
            first.child.kill("SIGKILL");
            await exit(first.child);
            expect((await lstat(join(state, "daemon.sock"))).isSocket()).toBe(
                true,
            );
            const second = launch();
            await second.ready();
            const nextNative = JSON.parse(await readFile(marker, "utf8")) as {
                pid: number;
            };
            const nextWire = JSON.parse(await readFile(wireMarker, "utf8")) as {
                pid: number;
            };
            nativePids.push(nextNative.pid, nextWire.pid);
            await waitFor(async () => !alive(firstWire.pid));
            expect(nextNative.pid).not.toBe(firstNative.pid);
            expect(alive(firstNative.pid)).toBe(false);
            const store = new EncryptedStore(join(state, "requests"));
            await store.init();
            expect(await store.get(running)).toMatchObject({
                status: "unknown",
            });
            expect((await store.get(running))?.terminalEvent).toBeUndefined();
            expect(await store.get(completed)).toMatchObject({
                status: "completed",
                result: { text: "fixture result" },
                terminalEvent: { fixture: true },
                terminalDelivered: false,
            });
            const preserved = await Promise.all(
                [
                    "requests/key",
                    `requests/${completed}.enc`,
                    "nonces/key",
                    `nonces/${nonce}.enc`,
                ].map((path) => readFile(join(state, path))),
            );
            expect(preserved).toEqual([
                snapshot[0],
                snapshot[2],
                snapshot[3],
                snapshot[4],
            ]);
            second.child.kill("SIGTERM");
            await exit(second.child);
            await expect(
                lstat(join(state, "daemon.sock")),
            ).rejects.toMatchObject({ code: "ENOENT" });
            await expect(fetch(endpoint + "/api/version")).rejects.toThrow();
            expect(alive(nextWire.pid)).toBe(false);
        } finally {
            for (const child of children)
                if (child.exitCode === null && child.signalCode === null)
                    child.kill("SIGKILL");
            try {
                nativePids.push(JSON.parse(await readFile(marker, "utf8")).pid);
            } catch {
                /* Never started. */
            }
            try {
                nativePids.push(
                    JSON.parse(await readFile(wireMarker, "utf8")).pid,
                );
            } catch {
                /* Never started. */
            }
            for (const pid of nativePids) {
                try {
                    const command = execFileSync(
                        "ps",
                        ["-p", String(pid), "-o", "command="],
                        {
                            encoding: "utf8",
                            stdio: ["ignore", "pipe", "ignore"],
                        },
                    );
                    if (
                        command.includes(binary) ||
                        command.includes(wireBinary)
                    )
                        process.kill(pid, "SIGKILL");
                } catch {
                    /* Already reaped. */
                }
            }
            await rm(directory, { recursive: true, force: true });
        }
    },
    15000,
);

it("refuses incomplete recovery guards and unsafe socket paths without deleting owner data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "panas-claim-"));
    try {
        await mkdir(join(dir, "host.starting"));
        await expect(claimProviderHost(dir)).rejects.toThrow(
            "PROVIDER_STARTUP_IN_PROGRESS",
        );
        await rm(join(dir, "host.starting"), { recursive: true });
        const target = join(dir, "keep");
        await writeFile(target, "preserve");
        await symlink(target, join(dir, "daemon.sock"));
        await expect(claimProviderHost(dir)).rejects.toThrow("UNSAFE_IPC_PATH");
        expect(await readFile(target, "utf8")).toBe("preserve");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

it("does not adopt or terminate an unrelated listener during recovery", async () => {
    const server = createServer((socket) => socket.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("NO_FIXTURE_PORT");
    try {
        await expect(
            waitForPreviousRuntime(new URL(`http://127.0.0.1:${address.port}`)),
        ).rejects.toThrow("PREVIOUS_RUNTIME_STILL_LISTENING");
        expect(server.listening).toBe(true);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
