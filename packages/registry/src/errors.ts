export type RegistryErrorCode =
    | "UNAUTHORIZED"
    | "INVALID_INPUT"
    | "INVALID_EVIDENCE"
    | "STALE_REPORT"
    | "OUT_OF_ORDER"
    | "REPLAYED_REQUEST"
    | "NOT_FOUND"
    | "UNAVAILABLE";
export class RegistryError extends Error {
    constructor(
        readonly code: RegistryErrorCode,
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}
