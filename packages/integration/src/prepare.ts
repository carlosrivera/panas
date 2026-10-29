import {
    generateKeyPairSync,
    createPrivateKey,
    createPublicKey,
    randomUUID,
} from "node:crypto";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { parseEnv } from "node:util";
import { z } from "zod";
import pg from "pg";
import { AccountingService } from "@panas/accounting";
import { keyId } from "@panas/protocol";
import {
    setupSchema,
    readPrivate,
    privateDirectory,
    privateWrite,
    localConfigSchema,
} from "./config.js";

export async function openOperator(path: string) {
    const env = parseEnv(await readPrivate(path));
    const database = env.PANAS_REGISTRY_DATABASE_URL,
        key = env.PANAS_PLATFORM_PRIVATE_KEY_BASE64,
        descriptor = env.PANAS_DESCRIPTOR_KEY_BASE64;
    if (!database || !key || !descriptor)
        throw new Error("OPERATOR_CONFIGURATION_MISSING");
    const privateKey = createPrivateKey(Buffer.from(key, "base64"));
    const pool = new pg.Pool({
        connectionString: database,
        max: 2,
        connectionTimeoutMillis: 10000,
        query_timeout: 15000,
    });
    pool.on("error", () => {});
    return {
        pool,
        privateKey,
        service: new AccountingService(pool, {
            platformPrivateKey: privateKey,
            descriptorEncryptionKey: Buffer.from(descriptor, "base64"),
        }),
    };
}
export async function prepare(path: string): Promise<string> {
    const config = setupSchema.parse(JSON.parse(await readPrivate(path)));
    await privateDirectory(config.privateDir);
    try {
        await access(join(config.privateDir, "run.json"));
        throw new Error("USE_NEW_PRIVATE_DIRECTORY");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const operator = await openOperator(config.operatorEnvPath);
    try {
        const pinned = createPublicKey(
            await readPrivate(config.platformPublicKeyPath),
        );
        if (keyId(pinned) !== keyId(operator.privateKey))
            throw new Error("PLATFORM_PIN_MISMATCH");
        const providerIds: [string, string] = [randomUUID(), randomUUID()];
        const providerEnvs: [string, string] = [
            join(config.privateDir, "provider-a.env"),
            join(config.privateDir, "provider-b.env"),
        ];
        const discoveryPath = join(config.privateDir, "discovery-token"),
            platformPath = join(config.privateDir, "platform-public.pem");
        await privateWrite(
            discoveryPath,
            await readPrivate(config.discoveryTokenPath),
        );
        await privateWrite(
            platformPath,
            await readPrivate(config.platformPublicKeyPath),
        );
        for (const i of [0, 1] as const) {
            const pair = generateKeyPairSync("ed25519"),
                keyPath = join(config.privateDir, `provider-${i}.pem`);
            await privateWrite(
                keyPath,
                pair.privateKey
                    .export({ type: "pkcs8", format: "pem" })
                    .toString(),
            );
            await operator.pool.query(
                "INSERT INTO panas_provider_keys(provider_id,public_key_pem) VALUES($1,$2)",
                [
                    providerIds[i],
                    pair.publicKey
                        .export({ type: "spki", format: "pem" })
                        .toString(),
                ],
            );
            const values: Record<string, string> = {
                PANAS_PROVIDER_ID: providerIds[i],
                PANAS_OLLAMA_BINARY: config.runtime.binary,
                PANAS_MODELS_PATH: config.runtime.modelsPath,
                PANAS_MODEL_DIGEST: config.runtime.modelDigest,
                PANAS_OLLAMA_VERSION: config.runtime.version,
                PANAS_DATA_PATH: join(config.privateDir, `provider-${i}-state`),
                PANAS_OLLAMA_ENDPOINT: `http://127.0.0.1:${11601 + i}`,
                PANAS_PROVIDER_PRIVATE_KEY_PATH: keyPath,
                PANAS_PLATFORM_PUBLIC_KEY_PATH: platformPath,
                PANAS_REGISTRY_URL: config.registryUrl,
                PANAS_ACCOUNTING_URL: config.accountingUrl,
                PANAS_PRICE_VERSION: "integration-1",
                PANAS_PRICE_ATOMIC: String(i + 1),
            };
            await privateWrite(
                providerEnvs[i],
                Object.entries(values)
                    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
                    .join("\n") + "\n",
            );
        }
        const buyer = generateKeyPairSync("ed25519"),
            buyerId = randomUUID(),
            sessionId = randomUUID(),
            buyerKeyPath = join(config.privateDir, "buyer.pem");
        await privateWrite(
            buyerKeyPath,
            buyer.privateKey
                .export({ type: "pkcs8", format: "pem" })
                .toString(),
        );
        await operator.service.operatorEnrollBuyer({
            buyerId,
            publicKeyPem: buyer.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            maxRequestAtomic: "100",
            maxSessionAtomic: "1000",
            maxDailyAtomic: "1000",
            policyVersion: "integration-test-credits-only",
        });
        await operator.service.operatorOpenSession({
            buyerId,
            sessionId,
            capAtomic: "1000",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
        await operator.service.operatorFund({
            buyerId,
            amountAtomic: "1000",
            idempotencyKey: randomUUID(),
        });
        const buyerConfigPath = join(config.privateDir, "buyer.json");
        await privateWrite(
            buyerConfigPath,
            JSON.stringify(
                {
                    buyerId,
                    sessionId,
                    privateKeyPath: buyerKeyPath,
                    dataDir: join(config.privateDir, "buyer-state"),
                    accountingUrl: config.accountingUrl,
                    registryUrl: config.registryUrl,
                    discoveryTokenPath: discoveryPath,
                    platformPublicKeyPath: platformPath,
                    limits: {
                        maxRequestAtomic: "100",
                        maxSessionAtomic: "1000",
                        maxDailyAtomic: "1000",
                    },
                },
                null,
                2,
            ),
        );
        const output = join(config.privateDir, "run.json");
        await privateWrite(
            output,
            JSON.stringify(
                localConfigSchema.parse({
                    version: 1,
                    mode: "local-simulation",
                    physicalMachineCount: 1,
                    privateDir: config.privateDir,
                    registryUrl: config.registryUrl,
                    accountingUrl: config.accountingUrl,
                    buyerConfigPath,
                    providerEnvs,
                    providerIds,
                    runtimePorts: [11601, 11602],
                    operatorEnvPath: config.operatorEnvPath,
                }),
                null,
                2,
            ),
        );
        return output;
    } finally {
        await operator.pool.end();
    }
}
/** Used only for isolated spending-race identities, never changes an existing real buyer policy. */
export async function prepareRaceBuyer(
    configPath: string,
    budget: string,
): Promise<[string, string]> {
    z.string()
        .regex(/^[1-9][0-9]*$/)
        .parse(budget);
    const run = localConfigSchema.parse(
            JSON.parse(await readPrivate(configPath)),
        ),
        owner = JSON.parse(await readPrivate(run.buyerConfigPath)) as Record<
            string,
            unknown
        >,
        operator = await openOperator(run.operatorEnvPath);
    try {
        const pair = generateKeyPairSync("ed25519"),
            buyerId = randomUUID(),
            sessionId = randomUUID(),
            keyPath = join(run.privateDir, `race-${buyerId}.pem`);
        await privateWrite(
            keyPath,
            pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        );
        await operator.service.operatorEnrollBuyer({
            buyerId,
            publicKeyPem: pair.publicKey
                .export({ type: "spki", format: "pem" })
                .toString(),
            maxRequestAtomic: budget,
            maxSessionAtomic: budget,
            maxDailyAtomic: budget,
            policyVersion: "integration-spend-race",
        });
        await operator.service.operatorOpenSession({
            buyerId,
            sessionId,
            capAtomic: budget,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        await operator.service.operatorFund({
            buyerId,
            amountAtomic: budget,
            idempotencyKey: randomUUID(),
        });
        const paths: [string, string] = [
            join(run.privateDir, `race-${buyerId}-a.json`),
            join(run.privateDir, `race-${buyerId}-b.json`),
        ];
        for (const i of [0, 1] as const)
            await privateWrite(
                paths[i],
                JSON.stringify(
                    {
                        ...owner,
                        buyerId,
                        sessionId,
                        privateKeyPath: keyPath,
                        dataDir: join(
                            run.privateDir,
                            `race-${buyerId}-${i}-state`,
                        ),
                        limits: {
                            maxRequestAtomic: budget,
                            maxSessionAtomic: budget,
                            maxDailyAtomic: budget,
                        },
                    },
                    null,
                    2,
                ),
            );
        return paths;
    } finally {
        await operator.pool.end();
    }
}

export async function inspectFixtureRequest(
    configPath: string,
    requestId: string,
) {
    z.uuid().parse(requestId);
    const run = localConfigSchema.parse(
            JSON.parse(await readPrivate(configPath)),
        ),
        owner = z
            .object({ buyerId: z.uuid() })
            .parse(JSON.parse(await readPrivate(run.buyerConfigPath))),
        operator = await openOperator(run.operatorEnvPath);
    try {
        const request = await operator.pool.query(
            "SELECT status,receipt FROM panas_accounting_requests WHERE request_id=$1 AND buyer_id=$2",
            [requestId, owner.buyerId],
        );
        const balance = await operator.pool.query(
            "SELECT balance::text,held::text FROM panas_accounting_buyers WHERE buyer_id=$1",
            [owner.buyerId],
        );
        const settled = request.rowCount
            ? await operator.pool.query(
                  "SELECT count(*)::int AS count FROM panas_accounting_ledger WHERE request_id=$1 AND kind='settle'",
                  [requestId],
              )
            : { rows: [{ count: 0 }] };
        return {
            requestExists: request.rowCount === 1,
            status: request.rows[0]?.status as string | undefined,
            hasReceipt: !!request.rows[0]?.receipt,
            settlements: Number(settled.rows[0]?.count),
            balance: String(balance.rows[0]?.balance),
            held: String(balance.rows[0]?.held),
        };
    } finally {
        await operator.pool.end();
    }
}
