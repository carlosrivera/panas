import { expect, it, vi } from "vitest";
import worker, { type Env } from "../scripts/edge/api-worker.js";
it("rejects wrong route prefixes, unsupported enrollment methods, oversized bodies and rate-limited enrollment before database access", async () => {
    const env = {
        ENROLLMENT_LIMIT: { limit: vi.fn(async () => ({ success: false })) },
    } as unknown as Env;
    expect(
        (
            await worker.fetch(
                new Request("https://panas.test/registry-evil"),
                env,
            )
        ).status,
    ).toBe(404);
    expect(
        (
            await worker.fetch(
                new Request("https://panas.test/accounting/demo/enroll"),
                env,
            )
        ).status,
    ).toBe(405);
    const limited = await worker.fetch(
        new Request("https://panas.test/accounting/demo/enroll", {
            method: "POST",
            body: "{}",
        }),
        env,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    env.ENROLLMENT_LIMIT.limit = async () => ({ success: true });
    expect(
        (
            await worker.fetch(
                new Request("https://panas.test/accounting/demo/enroll", {
                    method: "POST",
                    body: "a".repeat(16385),
                }),
                env,
            )
        ).status,
    ).toBe(413);
});
