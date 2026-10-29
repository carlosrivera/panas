import { PLATFORM } from "./config.js";
interface DatabaseIdentity {
    id: string;
    project_id: string;
    name?: string;
    database_name?: string;
    connection_string: string;
}
interface BranchIdentity {
    id: string;
    database_id: string;
    project_id: string;
    name: string;
    status: string;
    ttl_seconds: number;
    expires_at: string;
    connection_string: string;
}
export function assertIsolatedBranch(
    url: string,
    source: DatabaseIdentity,
    branch: BranchIdentity,
    now = Date.now(),
) {
    const target = new URL(url),
        expected = new URL(branch.connection_string),
        parent = new URL(source.connection_string);
    if (
        source.project_id !== PLATFORM.projectId ||
        !["registry"].includes(source.name ?? source.database_name ?? "") ||
        branch.project_id !== PLATFORM.projectId ||
        branch.database_id !== source.id ||
        branch.id === source.id ||
        branch.name !== "platform_empty_check" ||
        branch.status !== "active" ||
        branch.ttl_seconds > 7200 ||
        branch.ttl_seconds < 3600 ||
        Date.parse(branch.expires_at) <= now ||
        Date.parse(branch.expires_at) > now + 7200000 ||
        !Number.isFinite(Date.parse(branch.expires_at)) ||
        target.href !== expected.href ||
        decodeURIComponent(target.username) !== `volcano_client_${branch.id}` ||
        target.username === parent.username
    )
        throw new Error(
            "Destructive fixture reset refused: supplied connection is not the API-verified short-lived Panas test branch",
        );
}
