import { randomUUID, type KeyLike } from "node:crypto";
import { fileURLToPath } from "node:url";
import { probePeer, superviseShare } from "@panas/mcpwire";
import { keyId } from "@panas/protocol";
import { signProviderRequest } from "@panas/registry";
import type { RegistryPrice } from "@panas/contracts/registry";
import type { ProviderDaemon } from "@panas/provider";
import type { AccountingPort } from "./accounting-client.js";
import type { ProviderHostService } from "./service.js";

export interface ControllerConfig {
    registryUrl: string;
    providerId: string;
    providerPublicKeyPem: string;
    privateKey: KeyLike;
    price: RegistryPrice;
}
/** Owns real transport/probe publication. No public or logged connection descriptor. */
export class ProviderController {
    private share: ReturnType<typeof superviseShare> | undefined;
    private startupId: string | undefined;
    private reportDigest: string | undefined;
    private descriptorExpires = 0;
    private ticking = false;
    private stopped = false;
    constructor(
        readonly config: ControllerConfig,
        readonly daemon: ProviderDaemon,
        readonly host: ProviderHostService,
        readonly accounting: AccountingPort,
    ) {}
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
        const response = await fetch(new URL(path, base), {
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
        if (!response.ok) throw new Error("REGISTRY_PUBLICATION_REJECTED");
        return (await response.json()) as Record<string, unknown>;
    }
    private async openShare(): Promise<void> {
        const report = this.daemon.status;
        if (!report || report.state !== "testing") return;
        await this.share?.stop();
        this.share = undefined;
        this.reportDigest = undefined;
        const session = superviseShare({
            command: process.execPath,
            args: [
                "--import",
                "tsx",
                fileURLToPath(new URL("./main.ts", import.meta.url)),
            ],
        });
        this.share = session;
        this.startupId = report.startupId;
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
        if (ready.kind !== "ready") throw new Error("TRANSPORT_NOT_READY");
        const evidence = await probePeer({
            ticket: ready.ticket,
            startupId: report.startupId,
        });
        this.daemon.verifyPeer(evidence);
        if (evidence.status !== "verified")
            throw new Error("PEER_NOT_VERIFIED");
        const current = this.daemon.status;
        const registered = await this.registry("/providers/register", {
            report: current,
            price: this.config.price,
        });
        if (typeof registered.reportDigest !== "string")
            throw new Error("REGISTRY_REPORT_NOT_BOUND");
        this.reportDigest = registered.reportDigest;
        this.descriptorExpires = Date.now() + 55 * 60000;
        await this.accounting.descriptor({
            startupId: report.startupId,
            ticket: ready.ticket,
            providerKeyId: keyId(this.config.privateKey),
            providerPublicKeyPem: this.config.providerPublicKeyPem,
            expiresAt: new Date(this.descriptorExpires).toISOString(),
        });
    }
    async tick(): Promise<void> {
        if (this.ticking || this.stopped) return;
        this.ticking = true;
        try {
            await this.daemon.health();
            const report = this.daemon.status;
            if (!report) return;
            if (
                this.descriptorExpires &&
                this.descriptorExpires < Date.now() + 60000
            ) {
                this.daemon.drain();
                try {
                    await this.daemon.retest();
                    this.daemon.resume();
                } catch {
                    return;
                }
            }
            if (this.startupId !== this.daemon.report?.startupId) {
                await this.share?.stop();
                this.share = undefined;
                this.reportDigest = undefined;
            }
            if (!this.share) {
                await this.openShare();
            }
            const heartbeat = this.daemon.heartbeat();
            if (heartbeat && this.reportDigest)
                await this.registry("/providers/heartbeat", {
                    providerId: this.config.providerId,
                    startupId: heartbeat.startupId,
                    sequence: heartbeat.sequence,
                    reportDigest: this.reportDigest,
                    state: heartbeat.state,
                });
        } catch {
            // Fail closed; registry readiness expires on its own TTL. Do not disclose child output/tickets.
            if (this.daemon.report && this.daemon.report.state !== "unhealthy")
                this.daemon.verifyPeer({
                    startupId: this.daemon.report.startupId,
                    status: "failed",
                    testedAt: new Date().toISOString(),
                });
        } finally {
            this.ticking = false;
            try {
                await this.host.flushTerminals();
            } catch {
                /* Durable outbox retries on the next controller tick. */
            }
        }
    }
    async stop(): Promise<void> {
        this.stopped = true;
        await this.share?.stop();
        this.share = undefined;
        await this.daemon.emergencyStop();
        try {
            await this.host.flushTerminals();
        } catch {
            /* Persisted outbox survives shutdown. */
        }
    }
}
