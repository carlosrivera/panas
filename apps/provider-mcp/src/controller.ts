import { gatewayDhtPort, type PeerAddress } from "@panas/contracts";
import { serviceUrl } from "@panas/contracts/service-url";
import { randomUUID, type KeyLike } from "node:crypto";
import { fileURLToPath } from "node:url";
import { probePeer, superviseShare } from "@panas/mcpwire";
import { keyId } from "@panas/protocol";
import { signProviderRequest } from "@panas/registry";
import type { RegistryPrice, Registration } from "@panas/contracts/registry";
import type { CapabilityReport } from "@panas/contracts/provider";
import type { ProviderDaemon } from "@panas/provider";
import type { AccountingPort } from "./accounting-client.js";
import type { ProviderHostService } from "./service.js";

export interface ControllerConfig {
    registryUrl: string;
    providerId: string;
    providerPublicKeyPem: string;
    privateKey: KeyLike;
    price: RegistryPrice;
    peerAddresses?: PeerAddress[];
}
class PublicationError extends Error {}
interface Publication {
    report: CapabilityReport;
    descriptor: Record<string, unknown>;
    staged: Registration;
    stageDone: boolean;
    descriptorDone: boolean;
    final?: Registration;
}
/** Owns real transport/probe publication. No public or logged connection descriptor. */
export class ProviderController {
    private share: ReturnType<typeof superviseShare> | undefined;
    private startupId: string | undefined;
    private reportDigest: string | undefined;
    private descriptorExpires = 0;
    private ticking = false;
    private stopped = false;
    private retiring: Promise<void> = Promise.resolve();
    private publication: Publication | undefined;
    private cloudUnavailable = true;
    private leaseExpires = 0;
    private retryAt = 0;
    private failures = 0;
    private publishedReady = false;
    constructor(
        readonly config: ControllerConfig,
        readonly daemon: ProviderDaemon,
        readonly host: ProviderHostService,
        readonly accounting: AccountingPort,
    ) {
        this.daemon.setControlPlaneAvailable(false);
    }
    /** Runs before the tick lock so a suspended in-flight probe cannot retain its share. */
    observeLiveness(): void {
        if (this.stopped) return;
        if (this.daemon.observeLiveness()) this.retireShare();
        else if (this.cloudUnavailable) this.daemon.heartbeat(); // Local progress, never a cloud acknowledgement.
    }
    private retireShare(): void {
        this.blockCloud();
        const session = this.share;
        this.share = undefined;
        this.startupId = undefined;
        this.reportDigest = undefined;
        this.descriptorExpires = 0;
        this.publication = undefined;
        this.leaseExpires = 0;
        this.publishedReady = false;
        if (session) {
            this.retiring = Promise.all([this.retiring, session.stop()]).then(
                () => {},
            );
            void this.retiring.catch(() => {});
        }
    }
    private async registry(
        path: string,
        body: unknown,
    ): Promise<Record<string, unknown>> {
        const base = new URL(this.config.registryUrl);
        if (
            base.protocol !== "https:" &&
            !(
                base.protocol === "http:" &&
                ["127.0.0.1", "localhost"].includes(base.hostname)
            )
        )
            throw new Error(
                "Registry requires HTTPS or local development loopback",
            );
        if (base.username || base.password || base.search || base.hash)
            throw new Error("Invalid registry URL");
        const raw = JSON.stringify(body);
        const proof = signProviderRequest(
            this.config.privateKey,
            this.config.providerId,
            path,
            raw,
            String(Date.now()),
            randomUUID(),
        );
        const started = Date.now();
        try {
            const response = await fetch(serviceUrl(base, path), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-panas-provider-id": proof.providerId,
                    "x-panas-timestamp": proof.timestamp,
                    "x-panas-nonce": proof.nonce,
                    "x-panas-signature": proof.signature,
                },
                body: raw,
                signal: AbortSignal.timeout(10000),
                redirect: "error",
            });
            if (!response.ok)
                throw new PublicationError("REGISTRY_PUBLICATION_REJECTED");
            const result = (await response.json()) as Record<string, unknown>;
            const expected = body as {
                report?: CapabilityReport;
                startupId?: string;
                state?: string;
            };
            const expires = Date.parse(String(result?.expiresAt));
            if (
                !result ||
                result.providerId !== this.config.providerId ||
                result.startupId !==
                    (expected.report?.startupId ?? expected.startupId) ||
                result.state !== (expected.report?.state ?? expected.state) ||
                !Number.isFinite(expires) ||
                expires <= Date.now() ||
                (expected.report &&
                    (result.sequence !== expected.report.sequence ||
                        typeof result.reportDigest !== "string" ||
                        !/^[a-f0-9]{64}$/.test(result.reportDigest)))
            )
                throw new PublicationError("REGISTRY_PUBLICATION_REJECTED");
            this.leaseExpires = Math.min(started + 45000, expires); // Do not extend a lease by response latency.
            return result;
        } catch {
            throw new PublicationError("REGISTRY_PUBLICATION_UNAVAILABLE");
        }
    }
    private async openShare(): Promise<void> {
        // Test connectivity while preserving an owner's paused/draining publication state.
        const report = this.daemon.report;
        if (!report || report.state !== "testing") return;
        this.retireShare();
        await this.retiring;
        this.observeLiveness();
        if (
            this.stopped ||
            this.daemon.report !== report ||
            report.state !== "testing"
        )
            return;
        const session = superviseShare({
            ...(this.config.peerAddresses?.length
                ? { port: gatewayDhtPort }
                : {}),
            command: process.execPath,
            args: [
                ...(import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : []),
                fileURLToPath(
                    new URL(
                        import.meta.url.endsWith(".ts")
                            ? "./main.ts"
                            : "./main.js",
                        import.meta.url,
                    ),
                ),
            ],
        });
        this.share = session;
        this.startupId = report.startupId;
        const assertCurrent = () => {
            this.observeLiveness();
            if (
                this.stopped ||
                this.share !== session ||
                this.daemon.report !== report ||
                report.state === "unhealthy"
            )
                throw new Error("STALE_TRANSPORT");
        };
        void session.closed
            .then(() => {
                if (this.share !== session || this.stopped) return;
                this.share = undefined;
                this.reportDigest = undefined;
                this.daemon.verifyPeer({
                    startupId: report.startupId,
                    status: "failed",
                    testedAt: new Date().toISOString(),
                });
            })
            .catch(() => {});
        const ready = await session.ready;
        assertCurrent();
        if (ready.kind !== "ready") throw new Error("TRANSPORT_NOT_READY");
        const evidence = await probePeer({
            ticket: ready.ticket,
            startupId: report.startupId,
        });
        assertCurrent();
        this.daemon.verifyPeer(evidence);
        if (evidence.status !== "verified")
            throw new Error("PEER_NOT_VERIFIED");
        this.descriptorExpires = Date.now() + 55 * 60000;
        this.leaseExpires = Date.now() + 45000;
        this.publication = {
            report,
            staged: {
                report: {
                    ...structuredClone(this.daemon.localStatus!),
                    state: "testing",
                },
                price: this.config.price,
            },
            stageDone: false,
            descriptorDone: false,
            descriptor: {
                startupId: report.startupId,
                ticket: ready.ticket,
                ...(this.config.peerAddresses?.length
                    ? { peerAddresses: this.config.peerAddresses }
                    : {}),
                providerKeyId: keyId(this.config.privateKey),
                providerPublicKeyPem: this.config.providerPublicKeyPem,
                expiresAt: new Date(this.descriptorExpires).toISOString(),
            },
        };
    }
    private async publish(): Promise<void> {
        const publication = this.publication;
        if (!publication) return;
        const assertCurrent = () => {
            this.observeLiveness();
            if (
                this.stopped ||
                this.publication !== publication ||
                this.daemon.report !== publication.report ||
                publication.report.state === "unhealthy"
            )
                throw new Error("STALE_PUBLICATION");
        };
        assertCurrent();
        if (!publication.stageDone) {
            const result = await this.registry(
                "/providers/register",
                publication.staged,
            );
            assertCurrent();
            if (typeof result.reportDigest !== "string")
                throw new PublicationError("REGISTRY_REPORT_NOT_BOUND");
            publication.stageDone = true;
        }
        if (!publication.descriptorDone || this.cloudUnavailable) {
            try {
                await this.accounting.descriptor(publication.descriptor);
            } catch {
                throw new PublicationError("DESCRIPTOR_UNAVAILABLE");
            }
            assertCurrent();
            publication.descriptorDone = true;
        }
        if (!this.reportDigest) {
            publication.final ??= {
                report: {
                    ...structuredClone(this.daemon.localStatus!),
                    sequence: this.daemon.report!.sequence + 1,
                },
                price: this.config.price,
            };
            const result = await this.registry(
                "/providers/register",
                publication.final,
            );
            assertCurrent();
            if (typeof result.reportDigest !== "string")
                throw new PublicationError("REGISTRY_REPORT_NOT_BOUND");
            this.reportDigest = result.reportDigest;
            this.publishedReady = publication.final.report.state === "ready";
            publication.report.sequence = Math.max(
                publication.report.sequence,
                publication.final.report.sequence,
            );
        }
    }
    private blockCloud(): void {
        this.cloudUnavailable = true;
        this.daemon.setControlPlaneAvailable(false);
    }
    private backoff(): void {
        this.failures = Math.min(this.failures + 1, 3);
        this.retryAt =
            Date.now() + Math.min(60000, 15000 * 2 ** (this.failures - 1));
    }
    async tick(): Promise<void> {
        this.observeLiveness();
        if (this.ticking || this.stopped) return;
        this.ticking = true;
        let observedReport = this.daemon.report;
        let flushed = false;
        try {
            await this.daemon.health();
            const report = this.daemon.status;
            if (!report) return;
            if (this.cloudUnavailable) await this.daemon.suspendControlPlane();
            if (Date.now() < this.retryAt) return;
            if (
                (this.descriptorExpires &&
                    this.descriptorExpires < Date.now() + 60000) ||
                (this.leaseExpires && Date.now() >= this.leaseExpires) ||
                (this.reportDigest &&
                    !this.publishedReady &&
                    this.daemon.localStatus?.state === "ready")
            ) {
                this.blockCloud();
                await this.daemon.suspendControlPlane();
                try {
                    await this.daemon.retest();
                } catch {
                    return;
                }
            }
            if (this.startupId !== this.daemon.report?.startupId) {
                this.retireShare();
                await this.retiring;
            }
            if (!this.share) {
                observedReport = this.daemon.report;
                await this.openShare();
            }
            if (this.cloudUnavailable) {
                flushed = true;
                try {
                    await this.host.flushTerminals();
                } catch {
                    throw new PublicationError("TERMINAL_DELIVERY_UNAVAILABLE");
                }
            }
            await this.publish();
            const heartbeat = this.daemon.heartbeat();
            const publication = this.publication;
            if (heartbeat && this.reportDigest) {
                await this.registry("/providers/heartbeat", {
                    providerId: this.config.providerId,
                    startupId: heartbeat.startupId,
                    sequence: heartbeat.sequence,
                    reportDigest: this.reportDigest,
                    state: this.daemon.localStatus!.state,
                });
                this.observeLiveness();
                if (
                    !publication ||
                    this.publication !== publication ||
                    this.daemon.report !== publication.report ||
                    publication.report.state === "unhealthy"
                )
                    throw new Error("STALE_PUBLICATION");
            }
            if (heartbeat && this.reportDigest) {
                this.cloudUnavailable = false;
                this.daemon.setControlPlaneAvailable(true);
                this.failures = 0;
                this.retryAt = 0;
            }
        } catch (error) {
            this.blockCloud();
            try {
                await this.daemon.suspendControlPlane();
            } catch {
                /* Durable uncertainty remains unavailable. */
            }
            if (error instanceof PublicationError) {
                this.backoff();
                return; // Keep the peer/runtime for already-authorized work and authenticated retrieval.
            }
            this.retireShare();
            // Fail closed; registry readiness expires on its own TTL. Do not disclose child output/tickets.
            if (
                !this.daemon.observeLiveness() &&
                this.daemon.report &&
                this.daemon.report === observedReport &&
                this.daemon.report.state !== "unhealthy"
            )
                this.daemon.verifyPeer({
                    startupId: this.daemon.report.startupId,
                    status: "failed",
                    testedAt: new Date().toISOString(),
                });
        } finally {
            this.ticking = false;
            try {
                if (!flushed) await this.host.flushTerminals();
            } catch {
                this.blockCloud();
                this.backoff();
            }
        }
    }
    async stop(): Promise<void> {
        this.stopped = true;
        this.retireShare();
        await this.retiring;
        await this.daemon.emergencyStop();
        try {
            await this.host.flushTerminals();
        } catch {
            /* Persisted outbox survives shutdown. */
        }
    }
}
