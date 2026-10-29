import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
    mkdir,
    open,
    readFile,
    rename,
    readdir,
    unlink,
    chmod,
} from "node:fs/promises";
import { join } from "node:path";

export interface StoredRequest {
    requestId: string;
    buyerKeyId: string;
    fingerprint: string;
    status: "running" | "completed" | "cancelled" | "failed" | "unknown";
    updatedAt: number;
    /** Admission decision time; null means declined before acceptance. */
    admittedAt?: number | null;
    result?: {
        text: string;
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
        finishReason?: "stop" | "length" | "unknown";
    };
    error?: string;
    authorization?: unknown;
    terminalEvent?: unknown;
    terminalDelivered?: boolean;
}
export class EncryptedStore {
    private key?: Buffer;
    constructor(
        readonly path: string,
        readonly now = () => Date.now(),
    ) {}
    async init(): Promise<void> {
        await mkdir(this.path, { recursive: true, mode: 0o700 });
        await chmod(this.path, 0o700);
        const keyPath = join(this.path, "key");
        try {
            const f = await open(keyPath, "wx", 0o600);
            try {
                await f.writeFile(randomBytes(32));
                await f.sync();
            } finally {
                await f.close();
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        this.key = await readFile(keyPath);
        if (this.key.length !== 32) throw new Error("Invalid encryption key");
        await chmod(keyPath, 0o600);
    }
    private filename(id: string): string {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid request id");
        return join(this.path, `${id}.enc`);
    }
    async save(record: StoredRequest): Promise<void> {
        if (!this.key) throw new Error("Store not initialized");
        const iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const data = Buffer.concat([
            iv,
            cipher.update(JSON.stringify(record)),
            cipher.final(),
            cipher.getAuthTag(),
        ]);
        const file = this.filename(record.requestId),
            temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
        const f = await open(temp, "wx", 0o600);
        try {
            await f.writeFile(data);
            await f.sync();
        } finally {
            await f.close();
        }
        await rename(temp, file);
        const dir = await open(this.path, "r");
        try {
            await dir.sync();
        } finally {
            await dir.close();
        }
    }
    async get(id: string): Promise<StoredRequest | undefined> {
        if (!this.key) throw new Error("Store not initialized");
        let data: Buffer;
        try {
            data = await readFile(this.filename(id));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        const decipher = createDecipheriv(
            "aes-256-gcm",
            this.key,
            data.subarray(0, 12),
        );
        decipher.setAuthTag(data.subarray(-16));
        return JSON.parse(
            Buffer.concat([
                decipher.update(data.subarray(12, -16)),
                decipher.final(),
            ]).toString(),
        ) as StoredRequest;
    }
    async list(): Promise<StoredRequest[]> {
        const records: StoredRequest[] = [];
        for (const file of await readdir(this.path)) {
            if (!file.endsWith(".enc")) continue;
            const record = await this.get(file.slice(0, -4));
            if (record) records.push(record);
        }
        return records;
    }
    async recoverAndCleanup(recover = true): Promise<void> {
        for (const file of await readdir(this.path)) {
            if (!file.endsWith(".enc")) continue;
            const record = await this.get(file.slice(0, -4));
            if (!record) continue;
            const age = this.now() - record.updatedAt;
            if (age > 30 * 86400000) {
                await unlink(join(this.path, file));
                continue;
            }
            if (recover && record.status === "running") {
                record.status = "unknown";
                record.error = "Provider restarted; reconcile before retry";
                record.updatedAt = this.now();
                await this.save(record);
            } else if (age > 86400000 && record.result) {
                delete record.result;
                record.error = "Result retention expired";
                await this.save(record);
            }
        }
    }
}
