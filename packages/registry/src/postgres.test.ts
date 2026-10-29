import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresRegistryRepository } from "./repository";
import { RegistryService } from "./service";
import { signProviderRequest } from "./auth";
import { fixtureReport } from "./fixtures";
import type { Registration, Heartbeat } from "@panas/contracts/registry";

// Explicit opt-in: this test writes only ephemeral providers and removes its own rows.
const databaseUrl = process.env.PANAS_REGISTRY_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
    "real Postgres registry concurrency, replay, and readiness",
    { timeout: 30000 },
    () => {
        const pool = new pg.Pool({
            connectionString: databaseUrl,
            max: 5,
            connectionTimeoutMillis: 10000,
        });
        const repo = new PostgresRegistryRepository(pool);
        let now = new Date();
        const service = new RegistryService(repo, () => now);
        const keys = generateKeyPairSync("ed25519");
        const ids: string[] = [];
        async function enroll() {
            const id = randomUUID();
            ids.push(id);
            await pool.query(
                "INSERT INTO panas_provider_keys(provider_id,public_key_pem) VALUES($1,$2)",
                [
                    id,
                    keys.publicKey
                        .export({ type: "spki", format: "pem" })
                        .toString(),
                ],
            );
            return id;
        }
        function proof(
            id: string,
            path: string,
            body: string,
            nonce = randomUUID(),
        ) {
            return signProviderRequest(
                keys.privateKey,
                id,
                path,
                body,
                String(now.getTime()),
                nonce,
            );
        }
        async function register(id: string) {
            const data: Registration = {
                report: fixtureReport(now, id),
                price: {
                    version: "v1",
                    totalAtomic: "100",
                    currency: "TEST_CREDIT",
                },
            };
            const body = JSON.stringify(data);
            return {
                data,
                result: await service.register(
                    body,
                    proof(id, "/providers/register", body),
                ),
            };
        }
        beforeEach(() => {
            now = new Date();
        });
        beforeAll(async () => {
            await pool.query("SELECT 1");
        });
        afterAll(async () => {
            for (const table of [
                "panas_registry_nonces",
                "panas_registry_current",
                "panas_registry_reports",
                "panas_provider_keys",
            ])
                await pool.query(
                    `DELETE FROM ${table} WHERE provider_id=ANY($1::uuid[])`,
                    [ids],
                );
            await pool.end();
        });
        it("serializes concurrent first registration without duplicate report history", async () => {
            const id = await enroll();
            const data: Registration = {
                report: fixtureReport(now, id),
                price: {
                    version: "v1",
                    totalAtomic: "100",
                    currency: "TEST_CREDIT",
                },
            };
            const body = JSON.stringify(data);
            const [a, b] = await Promise.all([
                service.register(body, proof(id, "/providers/register", body)),
                service.register(body, proof(id, "/providers/register", body)),
            ]);
            expect(a.reportDigest).toBe(b.reportDigest);
            expect(
                (
                    await pool.query(
                        "SELECT count(*)::int AS count FROM panas_registry_reports WHERE provider_id=$1",
                        [id],
                    )
                ).rows[0].count,
            ).toBe(1);
        });
        it("rejects replayed authorization and never refreshes duplicate heartbeat liveness", async () => {
            const id = await enroll();
            const { data, result } = await register(id);
            const hb: Heartbeat = {
                providerId: id,
                startupId: data.report.startupId,
                sequence: 1,
                reportDigest: result.reportDigest,
                state: "ready",
            };
            const body = JSON.stringify(hb);
            const p = proof(id, "/providers/heartbeat", body);
            const first = await service.heartbeat(body, p);
            now = new Date(now.getTime() + 1000);
            await expect(service.heartbeat(body, p)).rejects.toMatchObject({
                code: "REPLAYED_REQUEST",
            });
            const retry = await service.heartbeat(
                body,
                proof(id, "/providers/heartbeat", body),
            );
            expect(retry.lastSeenAt).toBe(first.lastSeenAt);
            const older = JSON.stringify({ ...hb, sequence: 0 });
            await expect(
                service.heartbeat(
                    older,
                    proof(id, "/providers/heartbeat", older),
                ),
            ).rejects.toMatchObject({ code: "OUT_OF_ORDER" });
        });
        it("filters fixed-price/context/latency and expires providers at read time", async () => {
            const id = await enroll();
            await register(id);
            const page = await service.discover({
                maxPriceAtomic: "100",
                minContextTokens: 2048,
                maxLatencyMs: 100,
            });
            expect(page.providers.some((p) => p.providerId === id)).toBe(true);
            expect(
                (
                    await service.discover({ maxPriceAtomic: "99" })
                ).providers.some((p) => p.providerId === id),
            ).toBe(false);
            now = new Date(now.getTime() + 45000);
            expect(
                (await service.discover({})).providers.some(
                    (p) => p.providerId === id,
                ),
            ).toBe(false);
            expect((await service.getProvider(id)).readiness.reason).toBe(
                "heartbeat_expired",
            );
        });
        it("rejects failed/unverified evidence and stale startup resurrection", async () => {
            const id = await enroll();
            const { data } = await register(id);
            const forged = {
                ...data,
                report: {
                    ...data.report,
                    sequence: 1,
                    peerProbe: { status: "unverified" },
                },
            };
            let body = JSON.stringify(forged);
            await expect(
                service.register(body, proof(id, "/providers/register", body)),
            ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
            const old = {
                ...data,
                report: {
                    ...data.report,
                    startupId: randomUUID(),
                    testedAt: new Date(now.getTime() - 1000).toISOString(),
                },
            };
            body = JSON.stringify(old);
            await expect(
                service.register(body, proof(id, "/providers/register", body)),
            ).rejects.toMatchObject({ code: "OUT_OF_ORDER" });
        });
        it("retires unhealthy evidence until a new capability report is registered", async () => {
            const id = await enroll();
            const { data, result } = await register(id);
            const base = {
                providerId: id,
                startupId: data.report.startupId,
                reportDigest: result.reportDigest,
            };
            let body = JSON.stringify({
                ...base,
                sequence: 1,
                state: "unhealthy",
            });
            await service.heartbeat(
                body,
                proof(id, "/providers/heartbeat", body),
            );
            body = JSON.stringify({ ...base, sequence: 2, state: "ready" });
            await expect(
                service.heartbeat(
                    body,
                    proof(id, "/providers/heartbeat", body),
                ),
            ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
            const replayReport = JSON.stringify({
                ...data,
                report: { ...data.report, sequence: 2 },
            });
            await expect(
                service.register(
                    replayReport,
                    proof(id, "/providers/register", replayReport),
                ),
            ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
            now = new Date(now.getTime() + 1);
            data.report = {
                ...data.report,
                sequence: 2,
                testedAt: now.toISOString(),
                peerProbe: { status: "verified", testedAt: now.toISOString() },
            };
            body = JSON.stringify(data);
            expect(
                (
                    await service.register(
                        body,
                        proof(id, "/providers/register", body),
                    )
                ).readiness.ready,
            ).toBe(true);
        });
        it("checks enrolled key rotation again inside the mutation transaction", async () => {
            const id = await enroll();
            const report = fixtureReport(now, id);
            const oldKey = keys.publicKey
                .export({ type: "spki", format: "pem" })
                .toString();
            const newKey = generateKeyPairSync("ed25519")
                .publicKey.export({ type: "spki", format: "pem" })
                .toString();
            await pool.query(
                "UPDATE panas_provider_keys SET public_key_pem=$2 WHERE provider_id=$1",
                [id, newKey],
            );
            await expect(
                repo.register(
                    {
                        report,
                        price: {
                            version: "v1",
                            totalAtomic: "100",
                            currency: "TEST_CREDIT",
                        },
                    },
                    randomUUID(),
                    now,
                    oldKey,
                ),
            ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        });
        it("keeps public projection safe and honors enrollment revocation immediately", async () => {
            const id = await enroll();
            const { data } = await register(id);
            await pool.query(
                "UPDATE panas_provider_keys SET enabled=false WHERE provider_id=$1",
                [id],
            );
            expect(
                (await service.discover({ readyOnly: false })).providers.some(
                    (p) => p.providerId === id,
                ),
            ).toBe(false);
            await expect(service.getProvider(id)).rejects.toMatchObject({
                code: "NOT_FOUND",
            });
            await pool.query(
                "UPDATE panas_provider_keys SET enabled=true WHERE provider_id=$1",
                [id],
            );
            expect((await service.getProvider(id)).readiness.ready).toBe(false);
            const replay = JSON.stringify({
                ...data,
                report: { ...data.report, sequence: 1 },
            });
            await expect(
                service.register(
                    replay,
                    proof(id, "/providers/register", replay),
                ),
            ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
        });
    },
);
