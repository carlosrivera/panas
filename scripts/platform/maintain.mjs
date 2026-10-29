import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PLATFORM } from "./config.ts";
try {
    if (process.versions.node.split(".")[0] !== "24")
        throw new Error("Node 24 required");
    const link = JSON.parse(
        await readFile(
            new URL("../../.volcano/project.json", import.meta.url),
            "utf8",
        ),
    );
    if (
        link.project_id !== PLATFORM.projectId ||
        !process.env.VOLCANO_TOKEN?.startsWith("pt-")
    )
        throw new Error("Dedicated project credentials required");
    const request = async (path, body) => {
        const response = await fetch(
            `${PLATFORM.apiUrl}/projects/${PLATFORM.projectId}${path}`,
            {
                method: body ? "POST" : "GET",
                headers: {
                    authorization: `Bearer ${process.env.VOLCANO_TOKEN}`,
                    ...(body ? { "content-type": "application/json" } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(30000),
            },
        );
        if (!response.ok) throw new Error("Private maintenance request failed");
        return response.json();
    };
    const { data } = await request("/functions");
    const fn = data.find((item) => item.name === "operations");
    if (fn?.project_id !== PLATFORM.projectId || fn.status !== "active")
        throw new Error("Operations service unavailable");
    if (!/^[a-f0-9-]{36}$/.test(fn.id))
        throw new Error("Invalid private function identity");
    const keys = await request("/service-keys");
    const key = keys.data.find(
        (item) =>
            item.name === "panas-operations" &&
            item.project_id === PLATFORM.projectId,
    );
    if (!key?.key_value?.startsWith("sk-"))
        throw new Error("Operations service key unavailable");
    const response = await fetch(
        `${PLATFORM.apiUrl}/functions/${fn.id}/invoke`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${key.key_value}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ payload: { job: "reconcile" } }),
            signal: AbortSignal.timeout(30000),
        },
    );
    if (!response.ok) throw new Error("Private operational invocation failed");
    const invocation = await response.json();
    let result = invocation.payload ?? invocation.result ?? invocation;
    if (typeof result === "string") result = JSON.parse(result);
    if (
        result.ok !== true ||
        result.ledgerImbalanceCount !== 0 ||
        result.heldMismatchCount !== 0 ||
        !Number.isSafeInteger(result.markedPending) ||
        result.markedPending < 0 ||
        !Number.isSafeInteger(result.overduePendingCount) ||
        result.overduePendingCount < 0 ||
        typeof result.requiresOperatorReview !== "boolean" ||
        !Number.isFinite(Date.parse(result.observedAt)) ||
        !/^[a-f0-9]{40}$/.test(result.releaseSha)
    )
        throw new Error("Operational invariant check failed");
    const confirmation = await fetch(
        `${PLATFORM.apiUrl}/functions/${fn.id}/invoke`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${key.key_value}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ payload: { job: "health" } }),
            signal: AbortSignal.timeout(30000),
        },
    );
    if (!confirmation.ok)
        throw new Error("Maintenance persistence probe failed");
    const confirmed = await confirmation.json();
    let health = confirmed.payload ?? confirmed.result ?? confirmed;
    if (typeof health === "string") health = JSON.parse(health);
    if (
        health.ok !== true ||
        health.lastReconciliationObservedAt !== result.observedAt
    )
        throw new Error("Maintenance row was not durably observed");
    const report = {
        schemaVersion: 1,
        projectId: PLATFORM.projectId,
        observedAt: result.observedAt,
        releaseSha: result.releaseSha,
        markedPending: result.markedPending,
        overduePendingCount: result.overduePendingCount,
        requiresOperatorReview: result.requiresOperatorReview,
        ledgerImbalanceCount: 0,
        heldMismatchCount: 0,
    };
    await mkdir(new URL("../../artifacts/", import.meta.url), {
        recursive: true,
    });
    await writeFile(
        new URL("../../artifacts/maintenance.json", import.meta.url),
        JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
} catch {
    console.error(
        "Panas private maintenance failed; uncertain funds remain held. Check operator health without exposing credentials.",
    );
    process.exitCode = 1;
}
