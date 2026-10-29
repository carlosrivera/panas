import { describe, it, expect } from "vitest";
import { assertDescendant } from "./owned-runtime.js";
describe("owned runtime signal boundary", () => {
    it("accepts a runtime descendant and rejects another process tree, cycles, and the host itself", () => {
        const parents = new Map([
            [30, 20],
            [20, 10],
            [10, 1],
            [99, 1],
            [40, 41],
            [41, 40],
        ]);
        const parent = (pid: number) => parents.get(pid) ?? 1;
        expect(() => assertDescendant(30, 10, parent)).not.toThrow();
        for (const pid of [99, 40, 10, NaN, 0])
            expect(() => assertDescendant(pid, 10, parent)).toThrow(
                "RUNTIME_NOT_OWNED",
            );
    });
});
