import { z } from "zod";
import { isAbsolute } from "node:path";
import { constants } from "node:fs";
import { open, writeFile, mkdir, chmod } from "node:fs/promises";

const path = z.string().refine(isAbsolute);
export const TEST_REGISTRY_URL =
    "https://cdb5c197-93ad-4c13-8dca-45e1d18140f5.functions.volcano.run";
export const TEST_ACCOUNTING_URL =
    "https://e32b4a0e-51a7-4d7e-acab-b64501184f2a.functions.volcano.run";
export const setupSchema = z
    .object({
        privateDir: path,
        operatorEnvPath: path,
        registryUrl: z.literal(TEST_REGISTRY_URL),
        accountingUrl: z.literal(TEST_ACCOUNTING_URL),
        discoveryTokenPath: path,
        platformPublicKeyPath: path,
        runtime: z
            .object({
                binary: path,
                modelsPath: path,
                modelDigest: z.string().regex(/^[a-f0-9]{64}$/),
                version: z.string().regex(/^\d+\.\d+\.\d+$/),
            })
            .strict(),
    })
    .strict();
export const localConfigSchema = z
    .object({
        version: z.literal(1),
        mode: z.literal("local-simulation"),
        physicalMachineCount: z.literal(1),
        privateDir: path,
        registryUrl: z.literal(TEST_REGISTRY_URL),
        accountingUrl: z.literal(TEST_ACCOUNTING_URL),
        buyerConfigPath: path,
        providerEnvs: z.tuple([path, path]),
        providerIds: z.tuple([z.uuid(), z.uuid()]),
        runtimePorts: z.tuple([z.literal(11601), z.literal(11602)]),
        operatorEnvPath: path,
        releaseEvidencePath: path.optional(),
    })
    .strict();
export const manualConfigSchema = z
    .object({
        version: z.literal(1),
        mode: z.literal("manual-two-machine"),
        physicalMachineCount: z.literal(2),
        privateDir: path,
        registryUrl: z.literal(TEST_REGISTRY_URL),
        accountingUrl: z.literal(TEST_ACCOUNTING_URL),
        buyerConfigPath: path,
        physicalHosts: z.tuple([
            z
                .object({
                    alias: z.string().min(1).max(60),
                    providerId: z.uuid(),
                })
                .strict(),
            z
                .object({
                    alias: z.string().min(1).max(60),
                    providerId: z.uuid(),
                })
                .strict(),
        ]),
        operatorAttestation: z
            .string()
            .min(30)
            .max(2000)
            .refine(
                (value) =>
                    !/replace|placeholder|owner writes|owner-supplied/i.test(
                        value,
                    ),
                "Supply a real operator statement after actual hardware verification",
            ),
        releaseEvidencePath: path.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (
            value.physicalHosts[0].alias === value.physicalHosts[1].alias ||
            value.physicalHosts[0].providerId ===
                value.physicalHosts[1].providerId
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Two separate physical host aliases and providers are required",
            });
    });
export type LocalConfig = z.infer<typeof localConfigSchema>;
export type ManualConfig = z.infer<typeof manualConfigSchema>;
export async function readPrivate(path: string): Promise<string> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        if (
            !stat.isFile() ||
            stat.uid !== process.getuid?.() ||
            (stat.mode & 0o777) !== 0o600 ||
            stat.size > 65536
        )
            throw new Error(
                "Private owner file requires mode0600, current ownership, and bounded size",
            );
        return await file.readFile("utf8");
    } finally {
        await file.close();
    }
}
export async function privateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
}
export async function privateWrite(path: string, value: string): Promise<void> {
    await writeFile(path, value, { mode: 0o600 });
    await chmod(path, 0o600);
}
