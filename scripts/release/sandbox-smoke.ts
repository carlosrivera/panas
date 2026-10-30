import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    mkdtemp,
    mkdir,
    readFile,
    writeFile,
    rm,
    open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
    sandboxArgs,
    verifySandboxInspect,
    prepareIpcVolume,
} from "../../apps/cli/src/docker-provider.js";
import { stageApprovedModel } from "../../apps/cli/src/model-stage.js";
const exec = promisify(execFile),
    docker = async (args: string[], timeout = 30000) =>
        (
            await exec("docker", args, { timeout, maxBuffer: 2 * 1024 * 1024 })
        ).stdout.trim();
const release = JSON.parse(
    await readFile(
        new URL("../../dist/panas-cli/release.json", import.meta.url),
        "utf8",
    ),
);
const image =
    process.env.PANAS_SANDBOX_BUILD_TAG ?? `panas-provider:${release.version}`;
const id = randomUUID(),
    prefix = `panas-${id}`,
    dir = await mkdtemp(join(tmpdir(), "panas-container-smoke-"));
const owned: string[] = [];
let staged: Awaited<ReturnType<typeof stageApprovedModel>> | undefined;
async function downloadModel() {
    const source = join(dir, "source");
    await mkdir(join(source, "blobs"), { recursive: true });
    await mkdir(join(source, "manifests/registry.ollama.ai/library/qwen2.5"), {
        recursive: true,
    });
    const pin = release.modelDigest;
    const response = await fetch(
        `https://registry.ollama.ai/v2/library/qwen2.5/blobs/sha256:${pin}`,
        { signal: AbortSignal.timeout(30000) },
    );
    assert(response.ok);
    const manifest = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(manifest).digest("hex"), pin);
    await writeFile(
        join(source, "manifests/registry.ollama.ai/library/qwen2.5/0.5b"),
        manifest,
    );
    const value = JSON.parse(manifest.toString("utf8"));
    for (const blob of [value.config, ...value.layers] as {
        digest: string;
        size: number;
    }[]) {
        assert.match(blob.digest, /^sha256:[a-f0-9]{64}$/);
        assert(blob.size < 1024 ** 3);
        const data = await fetch(
            `https://registry.ollama.ai/v2/library/qwen2.5/blobs/${blob.digest}`,
            { signal: AbortSignal.timeout(300000) },
        );
        assert(data.ok && data.body);
        const file = await open(
            join(source, "blobs", blob.digest.replace(":", "-")),
            "wx",
        );
        let bytes = 0;
        try {
            for await (const chunk of data.body) {
                bytes += chunk.length;
                assert(bytes <= blob.size);
                await file.write(chunk);
            }
        } finally {
            await file.close();
        }
        assert.equal(bytes, blob.size);
    }
    return source;
}
try {
    staged = await stageApprovedModel(
        process.env.PANAS_DOCKER_TEST_MODELS ?? (await downloadModel()),
        release.modelDigest,
    );
    const imageId = JSON.parse(await docker(["image", "inspect", image]))[0].Id;
    await prepareIpcVolume(id);
    for (const role of ["worker", "gateway"] as const) {
        const args = sandboxArgs(role, id, imageId, staged.modelsPath);
        if (role === "gateway") {
            args.splice(
                args.length - 1,
                1,
                "--entrypoint",
                "node",
                imageId,
                "-e",
                "setInterval(()=>{},1000)",
            );
        }
        await docker(args);
        const name = `${prefix}-${role}`;
        owned.push(name);
        verifySandboxInspect(
            JSON.parse(await docker(["inspect", name]))[0],
            role,
            id,
            imageId,
        );
        await docker(["start", name]);
        let ready = false;
        for (let n = 0; n < 60; n++) {
            const state = JSON.parse(await docker(["inspect", name]))[0].State;
            if (!state.Running)
                throw new Error(
                    `Container stopped: ${await docker(["logs", name])}`,
                );
            try {
                await docker([
                    "exec",
                    name,
                    "node",
                    "/opt/panas/apps/provider/src/container-probe.js",
                    role,
                ]);
                if (role === "worker")
                    await docker([
                        "exec",
                        name,
                        "node",
                        "-e",
                        "require('fs').accessSync('/ipc/runtime.sock')",
                    ]);
                ready = true;
                break;
            } catch {
                await new Promise((r) => setTimeout(r, 250));
            }
        }
        assert(ready, "Sandbox readiness");
    }
    await docker([
        "exec",
        `${prefix}-gateway`,
        "node",
        "-e",
        `const fs=require('fs'),p=require('path'),c=require('child_process');const root='/opt/panas/node_modules/@mcpwire/cli';const pkg=JSON.parse(fs.readFileSync(p.join(root,'package.json')));const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin.mcpwire;c.execFileSync(process.execPath,[p.join(root,bin),'--help'],{stdio:'pipe'});console.log('External MCPWire CLI loaded inside gateway');`,
    ]);
    const canary = join(dir, "host-canary");
    await writeFile(canary, randomUUID());
    const probe = `const fs=require('fs'),net=require('net');const denied=p=>{try{fs.readFileSync(p);return false;}catch(e){return ['ENOENT','EACCES'].includes(e.code);}};const writeDenied=p=>{try{fs.writeFileSync(p,'x');return false;}catch(e){return ['EROFS','EACCES'].includes(e.code);}};const r={hostFile:denied(${JSON.stringify(canary)}),dockerSocket:denied('/var/run/docker.sock'),providerKey:denied('/run/panas/provider.pem'),readonlyRoot:writeDenied('/etc/panas-probe'),readonlyModels:writeDenied('/models/panas-probe')};const s=net.connect({host:'1.1.1.1',port:443});s.on('connect',()=>{r.egress=false;s.destroy();});s.on('error',()=>{r.egress=true;});s.setTimeout(2000,()=>{r.egress=true;s.destroy();});s.on('close',()=>console.log(JSON.stringify(r)));`;
    const denial = JSON.parse(
        await docker(["exec", `${prefix}-worker`, "node", "-e", probe]),
    );
    assert(
        Object.values(denial).every((v) => v === true),
        JSON.stringify(denial),
    );
    const rpc = async (method: string, data: Record<string, unknown> = {}) => {
        const code = `const fs=require('fs'),http=require('http');const req=http.request({socketPath:'/ipc/runtime.sock',path:'/',method:'POST',headers:{authorization:'Bearer '+fs.readFileSync('/ipc/token','utf8')}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>console.log(s));});req.on('error',()=>process.exit(1));req.end(${JSON.stringify(JSON.stringify({ method, ...data }))});`;
        const value = JSON.parse(
            await docker(
                ["exec", `${prefix}-gateway`, "node", "-e", code],
                90000,
            ),
        );
        assert.equal(value.ok, true, method);
        return value.result;
    };
    await rpc("start");
    const info = await rpc("info");
    assert.equal(info.version, release.ollama);
    assert.equal(info.digest, release.modelDigest);
    assert.equal(info.sandbox, "docker-worker");
    const generation = await rpc("generate", {
        prompt: "Say hello.",
        maxOutputTokens: 8,
    });
    assert(generation.text.trim());
    assert(generation.outputTokens > 0 && generation.outputTokens <= 8);
    assert.equal(await rpc("cancellationCheck"), true);
    await rpc("stop");
    console.log(
        JSON.stringify({
            sandbox: "passed",
            denials: denial,
            pinsVerified: true,
            actualCpuInference: true,
            outputTokens: generation.outputTokens,
            cancellation: true,
            publicPeerDrill: false,
        }),
    );
} finally {
    for (const name of owned.reverse()) {
        await docker(["rm", "--force", name]).catch(() => {});
    }
    for (const suffix of ["ipc", "state"])
        await docker(["volume", "rm", `${prefix}-${suffix}`]).catch(() => {});
    await staged?.cleanup();
    await rm(dir, { recursive: true, force: true });
}
