import { z } from "zod";
/** Private UDP handshake routes; these never grant permission to run work. */
export const peerAddressSchema = z
    .object({
        host: z.ipv4().refine((host) => {
            const first = Number(host.split(".")[0]);
            return first > 0 && first < 224 && !host.endsWith(".255");
        }),
        port: z.number().int().min(1).max(65535),
    })
    .strict();
export const peerAddressesSchema = z.array(peerAddressSchema).max(8);
export type PeerAddress = z.infer<typeof peerAddressSchema>;
export const gatewayDhtPort = 49737;
