import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prototypeLimits } from "@panas/contracts";
import { createHttpHandler } from "./http.js";
import { toPublicProvider, toPublicPage } from "./public.js";
import type { RegistryService } from "./service.js";
const now = new Date("2026-10-28T20:00:00.000Z");
function provider() {
    return {
        providerId: randomUUID(),
        startupId: randomUUID(),
        capability: "text-inference",
        model: {
            name: "qwen2.5:0.5b",
            digest: "a".repeat(64),
            runtimeVersion: "0.40.12",
            private: "SECRET",
        },
        profile: { ...prototypeLimits },
        price: {
            version: "1",
            totalAtomic: "9007199254740993",
            currency: "TEST_CREDIT",
        },
        benchmark: {
            warmLatencyMs: 10,
            tokensPerSecond: 100,
            private: "SECRET",
        },
        testedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 45000).toISOString(),
        state: "ready",
        readiness: { ready: true, reason: "ready" },
        evidence: { source: "provider-reported", peerProbe: "verified" },
        ticket: "SECRET",
        prompt: "SECRET",
        publicKeyPem: "SECRET",
    };
}
function service() {
    const row = provider();
    const fake = {
        discover: vi.fn(async () => ({
            providers: [row],
            observedAt: now.toISOString(),
            nextCursor: null,
        })),
        getProvider: vi.fn(async () => row),
        register: vi.fn(),
        heartbeat: vi.fn(),
    };
    return {
        fake,
        handle: createHttpHandler(
            fake as unknown as RegistryService,
            undefined,
        ),
    };
}
describe("public informational boundary", () => {
    it("allows anonymous browser GET but publishes only the explicit nested projection", async () => {
        const { handle } = service();
        const r = await handle(
            new Request("https://registry.test/public/providers", {
                headers: { origin: "https://website.test" },
            }),
        );
        expect(r.status).toBe(200);
        expect(r.headers.get("access-control-allow-origin")).toBe("*");
        expect(r.headers.get("cache-control")).toBe("no-store");
        const text = await r.text();
        expect(text).not.toContain("SECRET");
        expect(text).not.toContain("startupId");
        expect(text).toContain("9007199254740993");
    });
    it("provides server observation time for safe detail-page expiry", async () => {
        const { handle } = service();
        const response = await handle(
            new Request(
                "https://registry.test/public/providers/" + randomUUID(),
            ),
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(typeof data.observedAt).toBe("string");
        expect(data.provider).toHaveProperty("readyUntil");
        expect(data.provider).not.toHaveProperty("startupId");
    });
    it("defaults directory to all visible providers and preserves exact price filters", async () => {
        const { fake, handle } = service();
        await handle(
            new Request(
                "https://registry.test/public/providers?maxPriceAtomic=9007199254740993",
            ),
        );
        expect(fake.discover).toHaveBeenCalledWith(
            expect.objectContaining({
                readyOnly: false,
                maxPriceAtomic: "9007199254740993",
            }),
        );
    });
    it("does not open agent discovery, MCP, writes, or arbitrary public paths", async () => {
        const { fake, handle } = service();
        for (const [method, path] of [
            ["GET", "/providers"],
            ["POST", "/public/providers"],
            ["POST", "/mcp"],
            ["GET", "/public/keys"],
        ] as const) {
            const r = await handle(
                new Request("https://registry.test" + path, { method }),
            );
            expect(r.status).toBeGreaterThanOrEqual(400);
        }
        expect(fake.register).not.toHaveBeenCalled();
        expect(fake.heartbeat).not.toHaveBeenCalled();
    });
    it("clamps ready lifetime to the earlier heartbeat or capability expiry", () => {
        const row = provider();
        row.testedAt = new Date(now.getTime() - 86400000 + 5000).toISOString();
        const value = toPublicProvider(row, now.toISOString());
        expect(value.readyUntil).toBe(
            new Date(now.getTime() + 5000).toISOString(),
        );
        expect(toPublicProvider(row, value.readyUntil).readiness).toEqual({
            ready: false,
            reason: "capability_report_expired",
        });
        const expired = provider();
        expect(
            toPublicProvider(expired, expired.expiresAt).readiness.reason,
        ).toBe("heartbeat_expired");
    });
    it("fails closed on malformed data rather than echoing internal fields", async () => {
        const { fake, handle } = service();
        fake.discover.mockResolvedValueOnce({
            providers: [
                {
                    ...provider(),
                    price: {
                        version: "1",
                        totalAtomic: "NaN",
                        currency: "TEST_CREDIT",
                    },
                },
            ],
            observedAt: now.toISOString(),
            nextCursor: null,
        });
        const response = await handle(
            new Request("https://registry.test/public/providers"),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain("SECRET");
        expect(() =>
            toPublicPage({
                providers: [],
                observedAt: "bad",
                nextCursor: null,
            }),
        ).toThrow();
    });
});
