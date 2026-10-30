import { setTimeout as delay } from "node:timers/promises";

export type VerificationStage =
    | "release_setup"
    | "anonymous_public_api"
    | "anonymous_api_authorization"
    | "accounting_authorization"
    | "authenticated_mcp"
    | "functions_deployment"
    | "private_operational_health"
    | "frontend"
    | "frontend_assets"
    | "frontend_deployment";
type FailureCode =
    | "CHECK_FAILED"
    | "REQUEST_FAILED"
    | "HTTP_STATUS"
    | "INVALID_CONTENT"
    | "UNTRUSTED_ASSET"
    | "DEPLOYMENT_NOT_ACTIVE"
    | "RELEASE_IDENTITY_MISMATCH"
    | "ACCOUNTING_INVARIANT_FAILED";

/** Only our bounded metadata can reach CI; never serialize an upstream error or body. */
export class VerificationError extends Error {
    readonly diagnostic: {
        stage: VerificationStage;
        code: FailureCode;
        path?: string;
        status?: number;
        resource?: string;
        resourceState?: string;
    };
    constructor(
        stage: VerificationStage,
        code: FailureCode,
        path?: string,
        status?: number,
        resource?: "health" | "registry" | "accounting" | "operations",
        resourceState?: string,
    ) {
        super(`${stage}: ${code}`);
        this.diagnostic = {
            stage,
            code,
            ...(resource ? { resource } : {}),
            ...(resourceState
                ? {
                      resourceState: [
                          "active",
                          "provisioning",
                          "failed",
                          "degraded",
                          "deleting",
                          "missing",
                          "queued",
                      ].includes(resourceState)
                          ? resourceState
                          : "unknown",
                  }
                : {}),
            ...(path && /^\/[A-Za-z0-9_./-]*$/.test(path) ? { path } : {}),
            ...(typeof status === "number" &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
                ? { status }
                : {}),
        };
    }
}
export function verificationError(error: unknown, stage: VerificationStage) {
    return error instanceof VerificationError
        ? error
        : new VerificationError(stage, "CHECK_FAILED");
}
/** Rollout retries must never turn a wrong release or financial inconsistency into readiness. */
export function assertOperationalHealth(
    value: unknown,
    expectedRevision: string,
) {
    const h = value as {
        ok?: unknown;
        releaseSha?: unknown;
        ledgerImbalanceCount?: unknown;
        heldMismatchCount?: unknown;
    } | null;
    if (!h || h.ok !== true)
        throw new VerificationError(
            "private_operational_health",
            "CHECK_FAILED",
        );
    if (h.releaseSha !== expectedRevision)
        throw new VerificationError(
            "private_operational_health",
            "RELEASE_IDENTITY_MISMATCH",
        );
    if (h.ledgerImbalanceCount !== 0 || h.heldMismatchCount !== 0)
        throw new VerificationError(
            "private_operational_health",
            "ACCOUNTING_INVARIANT_FAILED",
        );
}
export interface FrontendDeployment {
    id: string;
    project_id: string;
    name: string;
    status: string;
    site_url: string;
    current_deployment_id: string | null;
}
export async function probeFrontend(options: {
    url: string;
    frontendId?: string;
    projectId: string;
    deployment: (
        signal: AbortSignal,
    ) => Promise<FrontendDeployment | undefined>;
    fetch?: typeof fetch;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<unknown>;
    timeoutMs?: number;
    retryMs?: number;
    onRetry?: (failure: VerificationError, attempt: number) => void;
    onStage?: (stage: VerificationStage) => void;
}) {
    const now = options.now ?? (() => performance.now());
    const until = now() + (options.timeoutMs ?? 180000);
    const retryMs = options.retryMs ?? 5000;
    const origin = new URL(options.url).origin;
    let attempt = 0;
    for (;;) {
        attempt++;
        let stage: VerificationStage = "frontend";
        options.onStage?.(stage);
        function signal() {
            return AbortSignal.timeout(
                Math.max(1, Math.min(15000, until - now())),
            );
        }
        async function request(url: URL) {
            let response: Response;
            try {
                response = await (options.fetch ?? fetch)(url.href, {
                    redirect: "error",
                    signal: signal(),
                });
            } catch {
                throw new VerificationError(
                    stage,
                    "REQUEST_FAILED",
                    url.pathname,
                );
            }
            if (response.status !== 200) {
                await response.body?.cancel();
                throw new VerificationError(
                    stage,
                    "HTTP_STATUS",
                    url.pathname,
                    response.status,
                );
            }
            return response;
        }
        try {
            // A failed asset can belong to a superseded HTML snapshot. Every attempt
            // re-reads the real page; never retry only the old chunk URL or skip it.
            const page = await request(new URL(options.url));
            let html: string;
            try {
                html = await page.text();
            } catch {
                throw new VerificationError(stage, "REQUEST_FAILED", "/");
            }
            if (!html.toLowerCase().includes("panas"))
                throw new VerificationError(stage, "INVALID_CONTENT", "/");
            stage = "frontend_assets";
            options.onStage?.(stage);
            const paths = [
                ...new Set(
                    [
                        ...html.matchAll(
                            /(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g,
                        ),
                    ].map((match) => match[1]!),
                ),
            ];
            if (paths.length === 0 || paths.length > 64)
                throw new VerificationError(stage, "INVALID_CONTENT", "/");
            for (const path of paths) {
                let url: URL;
                try {
                    url = new URL(path, options.url);
                } catch {
                    throw new VerificationError(stage, "UNTRUSTED_ASSET");
                }
                if (
                    url.origin !== origin ||
                    url.username ||
                    url.password ||
                    !url.pathname.startsWith("/_next/static/")
                )
                    throw new VerificationError(stage, "UNTRUSTED_ASSET");
                const asset = await request(url);
                const invalid = /(?:text\/html|application\/json)/i.test(
                    asset.headers.get("content-type") ?? "",
                );
                await asset.body?.cancel();
                if (invalid)
                    throw new VerificationError(
                        stage,
                        "INVALID_CONTENT",
                        url.pathname,
                    );
            }
            stage = "frontend_deployment";
            options.onStage?.(stage);
            const record = await options.deployment(signal());
            if (
                !record ||
                record.project_id !== options.projectId ||
                record.name !== "panas" ||
                (options.frontendId
                    ? record.id !== options.frontendId
                    : new URL(record.site_url).origin !== origin)
            )
                throw new VerificationError(stage, "CHECK_FAILED");
            if (record.status !== "active" || !record.current_deployment_id)
                throw new VerificationError(stage, "DEPLOYMENT_NOT_ACTIVE");
            return { record, assetCount: paths.length, attempts: attempt };
        } catch (error) {
            const failure = verificationError(error, stage);
            if (!retryable(failure) || now() >= until) throw failure;
            options.onRetry?.(failure, attempt);
            await (options.sleep ?? delay)(Math.min(retryMs, until - now()));
            if (now() >= until) throw failure;
        }
    }
}

export interface FunctionDeployment {
    id: string;
    project_id: string;
    name: string;
    status: string;
    invoke_url: string;
    current_deployment_id: string | null;
}
/** CLI deployment completion and resource-list readiness are separate observations. */
export async function probeFunctions(options: {
    projectId: string;
    load: (signal: AbortSignal) => Promise<FunctionDeployment[]>;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<unknown>;
    timeoutMs?: number;
    retryMs?: number;
    onRetry?: (failure: VerificationError, attempt: number) => void;
}) {
    const now = options.now ?? (() => performance.now());
    const until = now() + (options.timeoutMs ?? 180000);
    for (let attempt = 1; ; attempt++) {
        try {
            const records = await options.load(
                AbortSignal.timeout(
                    Math.max(1, Math.min(15000, until - now())),
                ),
            );
            for (const name of [
                "health",
                "registry",
                "accounting",
                "operations",
            ] as const) {
                const record = records.find((r) => r.name === name);
                if (record && record.project_id !== options.projectId)
                    throw new VerificationError(
                        "functions_deployment",
                        "CHECK_FAILED",
                        undefined,
                        undefined,
                        name,
                    );
                if (
                    !record ||
                    record.status !== "active" ||
                    !record.current_deployment_id
                )
                    throw new VerificationError(
                        "functions_deployment",
                        "DEPLOYMENT_NOT_ACTIVE",
                        undefined,
                        undefined,
                        name,
                        record?.status ?? "missing",
                    );
            }
            return { records, attempts: attempt };
        } catch (error) {
            const failure = verificationError(error, "functions_deployment");
            if (!retryable(failure) || now() >= until) throw failure;
            options.onRetry?.(failure, attempt);
            await (options.sleep ?? delay)(
                Math.min(options.retryMs ?? 5000, until - now()),
            );
            if (now() >= until) throw failure;
        }
    }
}
function retryable(failure: VerificationError) {
    const { code, status } = failure.diagnostic;
    return (
        code === "REQUEST_FAILED" ||
        code === "DEPLOYMENT_NOT_ACTIVE" ||
        (code === "HTTP_STATUS" &&
            [404, 408, 429, 500, 502, 503, 504].includes(status ?? 0))
    );
}
