import { expect, it } from "vitest";
import { peerAddressesSchema } from "./connectivity";
it("bounds private connection routes without accepting URLs, multicast, malformed ports or extra fields", () => {
    expect(
        peerAddressesSchema.parse([{ host: "192.168.1.2", port: 52000 }]),
    ).toHaveLength(1);
    for (const route of [
        { host: "https://internal", port: 80 },
        { host: "224.1.2.3", port: 2 },
        { host: "0.0.0.0", port: 20 },
        { host: "127.0.0.1", port: 0 },
        { host: "127.0.0.1", port: 65536 },
        { host: "127.0.0.1", port: 1234, command: "bad" },
    ])
        expect(peerAddressesSchema.safeParse([route]).success).toBe(false);
    expect(
        peerAddressesSchema.safeParse(
            Array.from({ length: 9 }, () => ({
                host: "127.0.0.1",
                port: 1234,
            })),
        ).success,
    ).toBe(false);
});
