import { serviceUrl } from "@panas/contracts/service-url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type Server } from "node:https";
import { TEST_ACCOUNTING_URL } from "./config.js";

export interface Faults {
    newPurchases?: boolean;
    terminal?: boolean;
    authorize?: boolean;
}
const LIMIT = 1_048_576;
const requestPath = /^\/requests\/[a-f0-9-]{36}$/;
const providerPath =
    /^\/provider\/requests\/[a-f0-9-]{36}\/(authorize|terminal)$/;
function allowed(method: string, path: string): boolean {
    return method === "GET"
        ? requestPath.test(path)
        : method === "POST" &&
              (["/quotes", "/purchases", "/provider/descriptor"].includes(
                  path,
              ) ||
                  providerPath.test(path) ||
                  /^\/requests\/[a-f0-9-]{36}\/cancel$/.test(path));
}
async function bounded(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > LIMIT) throw new Error("PROXY_BODY_LIMIT");
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/** Local transport fault injection for this run's clients; never changes cloud configuration. */
export async function startFaultProxy(options: {
    upstream: string;
    privateDir: string;
    port?: number;
    /** Test seam only; the destination remains pinned even when a fetch implementation is supplied. */
    fetch?: typeof fetch;
}) {
    if (options.upstream.replace(/\/$/, "") !== TEST_ACCOUNTING_URL)
        throw new Error("FAULT_PROXY_UPSTREAM_NOT_PINNED");
    await mkdir(options.privateDir, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(options.privateDir, "fault-proxy-"));
    await chmod(directory, 0o700);
    const keyPath = join(directory, "localhost-key.pem");
    const caPath = join(directory, "localhost-cert.pem");
    try {
        await promisify(execFile)("openssl", [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=Panas local fault injection",
            "-addext",
            "subjectAltName=IP:127.0.0.1,DNS:localhost",
            "-keyout",
            keyPath,
            "-out",
            caPath,
        ]);
    } catch {
        throw new Error("FAULT_PROXY_CERTIFICATE_UNAVAILABLE");
    }
    await Promise.all([chmod(keyPath, 0o600), chmod(caPath, 0o600)]);
    let faults: Faults = {};
    const counts = {
        forwarded: 0,
        blockedNewPurchases: 0,
        blockedTerminal: 0,
        blockedAuthorize: 0,
        rejectedPath: 0,
    };
    const server: Server = createServer(
        { key: await readFile(keyPath), cert: await readFile(caPath) },
        async (request, response) => {
            const send = (status: number, body: string | Buffer) => {
                response.writeHead(status, {
                    "content-type": "application/json",
                    "cache-control": "no-store",
                });
                response.end(body);
            };
            const path = request.url ?? "";
            const method = request.method ?? "";
            if (!allowed(method, path)) {
                counts.rejectedPath++;
                request.resume();
                send(404, '{"error":{"code":"NOT_FOUND"}}');
                return;
            }
            const blocked =
                faults.newPurchases && ["/quotes", "/purchases"].includes(path)
                    ? "blockedNewPurchases"
                    : faults.terminal && path.endsWith("/terminal")
                      ? "blockedTerminal"
                      : faults.authorize && path.endsWith("/authorize")
                        ? "blockedAuthorize"
                        : undefined;
            if (blocked) {
                counts[blocked]++;
                request.resume();
                send(
                    503,
                    '{"error":{"code":"UNAVAILABLE","message":"Controlled local transport fault"}}',
                );
                return;
            }
            try {
                const body = await bounded(request);
                const headers = new Headers({ accept: "application/json" });
                for (const name of [
                    "content-type",
                    "x-panas-proof",
                    "authorization",
                ]) {
                    const value = request.headers[name];
                    if (typeof value === "string") headers.set(name, value);
                }
                counts.forwarded++;
                const result = await (options.fetch ?? fetch)(
                    serviceUrl(TEST_ACCOUNTING_URL, path),
                    {
                        method,
                        headers,
                        redirect: "error",
                        signal: AbortSignal.timeout(15_000),
                        ...(method === "POST"
                            ? { body: new Uint8Array(body) }
                            : {}),
                    },
                );
                const value = result.body
                    ? await bounded(
                          result.body as unknown as AsyncIterable<Uint8Array>,
                      )
                    : Buffer.alloc(0);
                send(result.status, value);
            } catch {
                if (!response.headersSent)
                    send(503, '{"error":{"code":"UNAVAILABLE"}}');
                else response.destroy();
            }
        },
    );
    server.requestTimeout = 20_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
        server.once("error", () =>
            reject(new Error("FAULT_PROXY_LISTEN_FAILED")),
        );
        server.listen(options.port ?? 11701, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("FAULT_PROXY_ADDRESS_UNAVAILABLE");
    return {
        url: `https://127.0.0.1:${address.port}`,
        caPath,
        setFaults(next: Faults) {
            faults = { ...faults, ...next };
        },
        snapshot() {
            return { ...counts };
        },
        async close() {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) =>
                    error
                        ? reject(new Error("FAULT_PROXY_CLOSE_FAILED"))
                        : resolve(),
                ),
            );
        },
    };
}
