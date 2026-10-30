export type BuyerErrorCode =
    | "INVALID_INPUT"
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "CONFLICT"
    | "PROVIDER_UNAVAILABLE"
    | "QUOTE_EXPIRED"
    | "SPENDING_LIMIT"
    | "UNAVAILABLE"
    | "UNCERTAIN"
    | "CANCELLED"
    | "PENDING_RECONCILIATION";
export class BuyerError extends Error {
    constructor(
        public readonly code: BuyerErrorCode,
        public readonly safeMessage: string,
        public readonly recovery?: { requestId: string; safeToRequote: true },
    ) {
        super(safeMessage);
        this.name = "BuyerError";
    }
}
export function publicError(error: unknown) {
    return error instanceof BuyerError
        ? {
              code: error.code,
              message: error.safeMessage,
              ...(error.recovery ? { recovery: error.recovery } : {}),
          }
        : {
              code: "UNAVAILABLE" as const,
              message:
                  "Buyer operation unavailable; retrieve existing request state before retrying",
          };
}
