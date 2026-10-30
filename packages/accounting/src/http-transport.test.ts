import { expect, it } from "vitest";
import { createHttpHandler } from "./http";
import type { AccountingService } from "./service";
const id = "11111111-1111-4111-8111-111111111111";
it.each(["/purchases", `/requests/${id}`])(
    "negotiates private routes for %s while preserving legacy descriptors and signed authorization",
    async (path) => {
        const descriptor = {
            ticket: "private-ticket",
            peerAddresses: [{ host: "192.168.1.2", port: 52000 }],
        };
        const payload = {
            descriptor,
            signedGrant: { payload: { id }, signature: "unchanged" },
            receipt: null,
        };
        let authenticated = 0;
        const handler = createHttpHandler({
            authenticate: async () => {
                authenticated++;
                return {};
            },
            purchase: async () => payload,
            getRequest: async () => payload,
        } as unknown as AccountingService);
        for (const supported of [false, true]) {
            const request = new Request(`https://account.test${path}`, {
                method: path === "/purchases" ? "POST" : "GET",
                headers: {
                    "x-panas-proof": "e30=",
                    ...(supported ? { "x-panas-peer-addresses": "1" } : {}),
                },
                ...(path === "/purchases" ? { body: "{}" } : {}),
            });
            const response = await handler(request);
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.signedGrant).toEqual(payload.signedGrant);
            expect(body.descriptor.ticket).toBe(descriptor.ticket);
            expect(body.descriptor.peerAddresses).toEqual(
                supported ? descriptor.peerAddresses : undefined,
            );
            expect(descriptor.peerAddresses).toHaveLength(1); // projection never mutates encrypted/source data
        }
        expect(authenticated).toBe(2);
    },
);
