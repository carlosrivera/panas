import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PLATFORM } from "./config.js";

export const root = resolve(import.meta.dirname, "../..");
export function cleanEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of ["VOLCANO_DEBUG", "NODE_DEBUG", "NODE_DEBUG_NATIVE"])
        delete env[name];
    if (env.VOLCANO_PROJECT_ID && env.VOLCANO_PROJECT_ID !== PLATFORM.projectId)
        throw new Error("Refusing a different Volcano project override");
    delete env.VOLCANO_PROJECT_ID;
    if (
        env.VOLCANO_API_URL &&
        env.VOLCANO_API_URL.replace(/\/$/, "") !== PLATFORM.apiUrl
    )
        throw new Error("Different Volcano API origin refused");
    return env;
}
export function run(command: string, args: string[], capture = false): string {
    try {
        return (
            execFileSync(command, args, {
                cwd: root,
                env: cleanEnvironment(),
                encoding: "utf8",
                stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
                maxBuffer: 16 * 1024 * 1024,
            }) ?? ""
        );
    } catch {
        throw new Error(
            `Platform command failed: ${command.split("/").at(-1)} ${args[0] ?? ""}; inspect sanitized build output`,
        );
    }
}
export const volcano = resolve(root, "node_modules/.bin/volcano");
export function revision() {
    return run("git", ["rev-parse", "HEAD"], true).trim();
}
export async function assertProjectBinding() {
    const link = JSON.parse(
        await readFile(resolve(root, ".volcano/project.json"), "utf8"),
    ) as { project_id?: string };
    if (link.project_id !== PLATFORM.projectId)
        throw new Error(
            "Committed Volcano project binding differs from Panas test project",
        );
    cleanEnvironment();
}
export function token() {
    const value = process.env.VOLCANO_TOKEN;
    if (!value?.startsWith("pt-"))
        throw new Error(
            "Set a dedicated Panas project access token; account-wide credentials are refused",
        );
    return value;
}
export class ManagementRequestError extends Error {
    constructor(readonly status?: number) {
        super("Volcano management request failed");
    }
}
export async function management<T = Record<string, unknown>>(
    path: string,
    init: RequestInit = {},
): Promise<T> {
    if (!path.startsWith(`/projects/${PLATFORM.projectId}/`))
        throw new Error(
            "Management route outside the dedicated project refused",
        );
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token()}`);
    if (init.body) headers.set("content-type", "application/json");
    let response: Response;
    try {
        response = await fetch(`${PLATFORM.apiUrl}${path}`, {
            ...init,
            headers,
            signal: init.signal ?? AbortSignal.timeout(30000),
        });
    } catch {
        throw new ManagementRequestError();
    }
    if (!response.ok) throw new ManagementRequestError(response.status);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
}
export async function variable(name: string): Promise<string> {
    const data = await management<{ name: string; value: string }>(
        `/projects/${PLATFORM.projectId}/variables/${encodeURIComponent(name)}`,
    );
    if (data.name !== name || typeof data.value !== "string" || !data.value)
        throw new Error("Required project variable is unavailable");
    return data.value;
}

export function assertClean() {
    if (run("git", ["status", "--porcelain"], true).trim())
        throw new Error(
            "Commit all release sources before deploying or verifying",
        );
}

export async function invokeOperations(
    fn: { id: string; project_id: string; name: string },
    payload: { job: "health" | "reconcile" },
): Promise<unknown> {
    if (
        fn.project_id !== PLATFORM.projectId ||
        fn.name !== "operations" ||
        !/^[a-f0-9-]{36}$/.test(fn.id)
    )
        throw new Error("Private function project binding refused");
    const keys = await management<{
        data: { name: string; project_id: string; key_value: string }[];
    }>(`/projects/${PLATFORM.projectId}/service-keys`);
    const key = keys.data.find(
        (key) =>
            key.name === "panas-operations" &&
            key.project_id === PLATFORM.projectId,
    );
    if (!key?.key_value?.startsWith("sk-"))
        throw new Error("Dedicated operations service key missing");
    let response: Response;
    try {
        response = await fetch(`${PLATFORM.apiUrl}/functions/${fn.id}/invoke`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${key.key_value}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ payload }),
            signal: AbortSignal.timeout(30000),
        });
    } catch {
        throw new Error("Private operational invocation failed");
    }
    if (!response.ok)
        throw new Error(
            `Private operational invocation returned ${response.status}`,
        );
    return (await response.json()) as unknown;
}
