import { z } from "zod";
import { constants } from "node:fs";
import {
    access,
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    rename,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function closed(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("error", () => {
            socket.destroy();
            resolve(true);
        });
        socket.setTimeout(500, () => {
            socket.destroy();
            resolve(false);
        });
    });
}

/** A test-only transport delay around an actual owner-installed native Ollama process. */
export async function prepareDelayedRuntime(options: {
    privateDir: string;
    binary: string;
    externalPort: number;
    upstreamPort: number;
    firstTokenObserver?: { url: string; token: string };
}) {
    if (options.firstTokenObserver) {
        const url = new URL(options.firstTokenObserver.url);
        if (
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            url.username ||
            url.password
        )
            throw new Error("OBSERVER_MUST_BE_LOOPBACK");
    }
    if (
        !isAbsolute(options.privateDir) ||
        !isAbsolute(options.binary) ||
        ![options.externalPort, options.upstreamPort].every(
            (p) => Number.isInteger(p) && p >= 1024 && p <= 65535,
        ) ||
        options.externalPort === options.upstreamPort
    )
        throw new Error("INVALID_DELAYED_RUNTIME_CONFIGURATION");
    await access(options.binary, constants.X_OK);
    await mkdir(options.privateDir, { recursive: true, mode: 0o700 });
    const parent = await lstat(options.privateDir);
    if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== process.getuid?.() ||
        parent.mode & 0o077
    )
        throw new Error("DELAYED_RUNTIME_REQUIRES_PRIVATE_OWNER_DIRECTORY");
    const directory = await mkdtemp(
        join(options.privateDir, "delayed-runtime-"),
    );
    await chmod(directory, 0o700);
    const binaryPath = join(directory, "ollama-wrapper.mjs");
    const controlPath = join(directory, "control.json");
    const token = randomBytes(32).toString("hex");
    const setHoldGenerate = async (hold: boolean) => {
        const temp = controlPath + ".tmp";
        await writeFile(temp, JSON.stringify({ holdGenerate: hold }), {
            mode: 0o600,
        });
        await rename(temp, controlPath);
    };
    const observeNextGeneration = async (observe: boolean) => {
        const temp = controlPath + ".tmp";
        await writeFile(
            temp,
            JSON.stringify({ holdGenerate: false, observe }),
            { mode: 0o600 },
        );
        await rename(temp, controlPath);
    };
    await setHoldGenerate(false);
    await writeFile(
        join(directory, "config.json"),
        JSON.stringify({ ...options, token }),
        { mode: 0o600 },
    );
    await writeFile(binaryPath, WRAPPER, { mode: 0o700 });
    return {
        binaryPath,
        setHoldGenerate,
        observeNextGeneration,
        async snapshot() {
            const response = await fetch(
                `http://127.0.0.1:${options.externalPort}/__panas_fault__/status`,
                {
                    headers: { authorization: "Bearer " + token },
                    signal: AbortSignal.timeout(2000),
                },
            );
            if (!response.ok)
                throw new Error("DELAYED_RUNTIME_SNAPSHOT_REJECTED");
            return z
                .object({
                    nativeGenerationsCompleted: z.number().int().nonnegative(),
                    heldGenerations: z.number().int().nonnegative(),
                    metadataResponses: z.number().int().nonnegative(),
                })
                .strict()
                .parse(await response.json());
        },
        async close() {
            if (!(await closed(options.externalPort))) {
                try {
                    const result = await fetch(
                        "http://127.0.0.1:" +
                            options.externalPort +
                            "/__panas_fault__/stop",
                        {
                            method: "POST",
                            headers: { authorization: "Bearer " + token },
                            signal: AbortSignal.timeout(2000),
                        },
                    );
                    if (!result.ok) throw new Error("OWNER_CONTROL_REJECTED");
                    await result.body?.cancel();
                } catch {
                    throw new Error("DELAYED_RUNTIME_OWNER_SHUTDOWN_FAILED");
                }
            }
            for (let attempt = 0; attempt < 40; attempt++) {
                if (
                    (await closed(options.externalPort)) &&
                    (await closed(options.upstreamPort))
                )
                    return;
                await delay(100);
            }
            throw new Error("DELAYED_RUNTIME_PORTS_REMAIN_OPEN");
        },
    };
}

// Kept as a standalone private executable so the production daemon owns its normal process group.
// Native child is deliberately NOT detached: terminating the daemon-owned group also kills it.
const WRAPPER = String.raw`#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
if (process.argv[2] !== 'serve') {
    if (!['--version', '-v'].includes(process.argv[2]) || process.argv.length !== 3) process.exit(64);
    const version = spawn(config.binary, process.argv.slice(2), {stdio:'inherit'});
    version.once('error', () => process.exit(1));
    version.once('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
} else {
    let child, stopping = false;
    const pending = new Set();
    const counters = {nativeGenerationsCompleted:0,heldGenerations:0,metadataResponses:0};
    const bounded = async body => {
        const chunks = []; let bytes = 0;
        for await (const value of body) {
            bytes += value.byteLength;
            if (bytes > 1048576) throw new Error('BOUNDED_BODY');
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
    };
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        for (const controller of pending) controller.abort();
        server.closeAllConnections(); server.close();
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise(r => child.once('exit', r)), delay(500)]);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        process.exit(0);
    };
    const server = createServer(async (request, response) => {
        if (request.url === '/__panas_fault__/status') {
            if (request.method !== 'GET' || request.headers.authorization !== 'Bearer ' + config.token) { response.writeHead(401).end(); return; }
            response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(counters)); return;
        }
        if (request.url === '/__panas_fault__/stop') {
            if (request.method !== 'POST' || request.headers.authorization !== 'Bearer ' + config.token) {
                response.writeHead(401).end(); return;
            }
            response.writeHead(200, {'content-type':'application/json'}).end('{"stopping":true}');
            setTimeout(() => { void shutdown(); }, 25); return;
        }
        const controller = new AbortController(); pending.add(controller);
        response.once('close', () => controller.abort());
        const timer = setTimeout(() => controller.abort(), 90000);
        let held = false;
        try {
            if (stopping || !child || !['GET','POST'].includes(request.method) || !/^\/api\/[a-z_]+$/.test(request.url)) {
                request.resume(); response.writeHead(503).end(); return;
            }
            const body = await bounded(request);
            const control = JSON.parse(await readFile(new URL('./control.json', import.meta.url), 'utf8'));
            const observe = request.url === '/api/generate' && control.observe && config.firstTokenObserver;
            const forwarded = observe ? Buffer.from(JSON.stringify({...JSON.parse(body.toString('utf8')), stream:true})) : body;
            const upstream = await fetch('http://127.0.0.1:' + config.upstreamPort + request.url, {
                method: request.method, redirect:'error', signal:controller.signal,
                headers:{'content-type':'application/json'},
                ...(request.method === 'POST' ? {body:new Uint8Array(forwarded)} : {}),
            });
            let result;
            if (observe && upstream.ok && upstream.body) {
                let buffer = '', text = '', final, notified = false, bytes = 0;
                const decoder = new TextDecoder();
                for await (const chunk of upstream.body) {
                    bytes += chunk.byteLength;
                    if (bytes > 1048576) throw new Error('BOUNDED_STREAM');
                    buffer += decoder.decode(chunk, {stream:true});
                    const lines = buffer.split('\n'); buffer = lines.pop();
                    const frames = lines.filter(Boolean).map(line => JSON.parse(line));
                    for (const frame of frames) { text += frame.response ?? ''; if (frame.done === true) final = frame; }
                    if (!notified && !final && frames.some(frame => frame.done === false && frame.response?.trim())) {
                        notified = true;
                        const observedAt = new Date().toISOString();
                        const ack = await fetch(config.firstTokenObserver.url, {
                            method:'POST', headers:{authorization:'Bearer ' + config.firstTokenObserver.token, 'content-type':'application/json'},
                            body:JSON.stringify({observedAt, wrapperPid:process.pid, nativePid:child.pid, nonFinal:true}),
                            signal:AbortSignal.timeout(2000),
                        });
                        if (!ack.ok) throw new Error('OBSERVATION_REJECTED');
                        await ack.body?.cancel();
                    }
                }
                if (buffer.trim()) { const frame = JSON.parse(buffer); text += frame.response ?? ''; if (frame.done === true) final = frame; }
                if (!final) throw new Error('NATIVE_STREAM_INTERRUPTED');
                result = Buffer.from(JSON.stringify({...final, response:text}));
            } else result = upstream.body ? await bounded(upstream.body) : Buffer.alloc(0);
            if (upstream.ok && ['/api/version','/api/tags'].includes(request.url)) counters.metadataResponses++;
            // Actual native work is already complete; only its transport response is delayed.
            if (request.url === '/api/generate' && upstream.ok) {
                counters.nativeGenerationsCompleted++;
                while (!controller.signal.aborted && !stopping) {
                    const control = JSON.parse(await readFile(new URL('./control.json', import.meta.url), 'utf8'));
                    if (!control.holdGenerate) break;
                    if (!held) { held = true; counters.heldGenerations++; }
                    await delay(25, undefined, {signal:controller.signal});
                }
            }
            if (!controller.signal.aborted && !response.destroyed) {
                response.writeHead(upstream.status, {'content-type':'application/json'}).end(result);
            }
        } catch {
            if (!response.destroyed && !response.headersSent) response.writeHead(503).end('{"error":"LOCAL_TRANSPORT_FAULT"}');
        } finally { if (held) counters.heldGenerations--; clearTimeout(timer); pending.delete(controller); }
    });
    server.requestTimeout = 95000;
    process.once('SIGTERM', () => { void shutdown(); });
    process.once('SIGINT', () => { void shutdown(); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.externalPort, '127.0.0.1', resolve); });
    const occupied = await new Promise(resolve => {
        const socket = createConnection({host:'127.0.0.1',port:config.upstreamPort});
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.setTimeout(500, () => { socket.destroy(); resolve(true); });
    });
    if (occupied) { server.close(); process.exit(65); }
    child = spawn(config.binary, ['serve'], {
        env:{...process.env, OLLAMA_HOST:'127.0.0.1:' + config.upstreamPort},
        stdio:'inherit', detached:false,
    });
    child.once('error', () => { void shutdown(); });
    child.once('exit', () => { if (!stopping) void shutdown(); });
}
`;
