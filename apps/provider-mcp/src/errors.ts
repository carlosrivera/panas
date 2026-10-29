/** Codes safe to carry from the authenticated private daemon into MCP tool failures. */
export const hostErrorCodes = new Set([
    "QUEUE_FULL",
    "RATE_LIMITED",
    "PROVIDER_UNAVAILABLE",
    "CONTEXT_TOO_LARGE",
    "GRANT_LIMIT_EXCEEDED",
    "INVALID_PLATFORM_GRANT",
    "IDENTITY_MISMATCH",
    "OPERATION_BINDING_MISMATCH",
    "EXECUTION_BINDING_MISMATCH",
    "REQUEST_NOT_FOUND",
    "REQUEST_BINDING_MISMATCH",
    "REPLAYED_OPERATION",
    "PERSISTENCE_UNCERTAIN",
]);
