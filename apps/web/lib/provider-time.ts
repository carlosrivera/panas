import type { PublicProvider } from "@panas/contracts/public-registry";
import { TEST_CREDIT_SCALE } from "@panas/contracts/public-registry";

const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
const SCHEDULING_GUARD_MS = 250;
export interface Observation {
    observedAt: string;
    startedAt: number;
    trusted: boolean;
}
/** Replayed or backward server observations cannot renew an existing client lease. */
export function anchorObservation(
    previous: Observation | null,
    observedAt: string,
    requestStartedAt: number,
): Observation {
    const advanced = previous
        ? previous.startedAt +
          Date.parse(observedAt) -
          Date.parse(previous.observedAt)
        : requestStartedAt;
    return {
        observedAt,
        startedAt: Math.min(requestStartedAt, advanced),
        trusted: true,
    };
}
export function remainingReadyMs(
    provider: PublicProvider,
    observation: Observation,
    monotonicNow: number,
): number {
    const end = Math.min(
        Date.parse(provider.readyUntil),
        Date.parse(provider.expiresAt),
        Date.parse(provider.testedAt) + REPORT_TTL_MS,
    );
    return Math.max(
        0,
        end -
            Date.parse(observation.observedAt) -
            Math.max(0, monotonicNow - observation.startedAt) -
            SCHEDULING_GUARD_MS,
    );
}
const reasonLabels: Record<PublicProvider["readiness"]["reason"], string> = {
    ready: "Ready as observed",
    heartbeat_expired: "Heartbeat expired",
    capability_report_expired: "Capability checks expired",
    capability_evidence_unverified: "Checks not verified",
    provider_offline: "Offline",
    provider_testing: "Testing",
    provider_busy: "Busy",
    provider_draining: "Draining",
    provider_paused: "Paused",
    provider_unhealthy: "Unhealthy",
};
export function displayedReadiness(
    provider: PublicProvider,
    observation: Observation,
    now: number,
): { label: string; tone: "ready" | "quiet" | "warning"; ready: boolean } {
    if (!observation.trusted)
        return { label: "Status unknown", tone: "warning", ready: false };
    if (!provider.readiness.ready)
        return {
            label: reasonLabels[provider.readiness.reason],
            tone: "quiet",
            ready: false,
        };
    if (remainingReadyMs(provider, observation, now) <= 0)
        return { label: "Readiness expired", tone: "warning", ready: false };
    return { label: "Ready as observed", tone: "ready", ready: true };
}
export function formatCredits(value: string): string {
    if (TEST_CREDIT_SCALE !== 0 || !/^(0|[1-9][0-9]{0,29})$/.test(value))
        throw new Error("Invalid public test-credit amount");
    const integer = BigInt(value);
    return `${new Intl.NumberFormat("en-US").format(integer)} ${integer === 1n ? "test credit" : "test credits"}`;
}
export function formatPublicDate(value: string): string {
    return (
        new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
        }).format(new Date(value)) + " UTC"
    );
}
