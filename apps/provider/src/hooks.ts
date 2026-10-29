import type { InferenceRequest } from "@panas/contracts";
import type { StoredRequest } from "./store.js";

/** Persistent daemon hooks; never installed in disposable peer adapters. */
export interface RequestHooks {
    timeoutMs?(record: StoredRequest): number;
    beforeExecute?(
        record: StoredRequest,
        request: InferenceRequest,
        signal: AbortSignal,
    ): Promise<void>;
    terminalEvent?(record: StoredRequest): unknown;
}
