import {
    constants,
    fstatSync,
    openSync,
    readFileSync,
    closeSync,
} from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { atomicAmountSchema } from "@panas/contracts";

export const ownerConfigSchema = z
    .object({
        buyerId: z.uuid(),
        sessionId: z.uuid(),
        privateKeyPath: z.string().refine(isAbsolute),
        dataDir: z.string().refine(isAbsolute),
        accountingUrl: z
            .url()
            .refine((value) => new URL(value).protocol === "https:"),
        registryUrl: z
            .url()
            .refine((value) => new URL(value).protocol === "https:"),
        discoveryTokenPath: z.string().refine(isAbsolute),
        platformPublicKeyPath: z.string().refine(isAbsolute),
        limits: z
            .object({
                maxRequestAtomic: atomicAmountSchema,
                maxSessionAtomic: atomicAmountSchema,
                maxDailyAtomic: atomicAmountSchema,
            })
            .strict(),
    })
    .strict();
export type OwnerConfig = z.infer<typeof ownerConfigSchema>;
/** Owner-only regular file, no symlink following; content is never logged. */
export function readPrivateFile(path: string, maxBytes = 65_536): Buffer {
    const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
        const stat = fstatSync(descriptor);
        if (
            !stat.isFile() ||
            (stat.mode & 0o777) !== 0o600 ||
            stat.uid !== process.getuid?.() ||
            stat.size > maxBytes
        )
            throw new Error(
                "Owner configuration requires a private regular file",
            );
        return readFileSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}
export function readOwnerConfig(path: string): OwnerConfig {
    return ownerConfigSchema.parse(
        JSON.parse(readPrivateFile(path).toString("utf8")),
    );
}
