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
    const invocation = await request(
        `/functions/${encodeURIComponent(fn.id)}/invoke`,
        { payload: { job: "reconcile" } },
    );
    let result = invocation.payload ?? invocation.result ?? invocation;
    if (typeof result === "string") result = JSON.parse(result);
    if (
        result.ok !== true ||
        result.ledgerImbalanceCount !== 0 ||
        result.heldMismatchCount !== 0
    )
        throw new Error("Operational invariant check failed");
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
