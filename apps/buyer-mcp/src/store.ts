import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
    chmodSync,
    closeSync,
    constants,
    existsSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readPrivateFile } from "./config";

/** One writer per data directory. Crash locks deliberately require owner recovery. */
export class PrivateStore<T> {
    private readonly lockPath: string;
    private readonly statePath: string;
    private readonly key: Buffer;
    private closed = false;
    constructor(
        private readonly directory: string,
        private readonly decode: (value: unknown) => T,
        private readonly empty: () => T,
    ) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = lstatSync(directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (stat.mode & 0o777) !== 0o700 ||
            stat.uid !== process.getuid?.()
        )
            throw new Error("Buyer data directory must be owner-only");
        this.lockPath = join(directory, "writer.lock");
        const lock = openSync(
            this.lockPath,
            constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
            0o600,
        );
        writeFileSync(lock, String(process.pid));
        closeSync(lock);
        this.statePath = join(directory, "requests.enc");
        try {
            const keyPath = join(directory, "store.key");
            if (!existsSync(keyPath))
                writeFileSync(keyPath, randomBytes(32), {
                    mode: 0o600,
                    flag: "wx",
                });
            this.key = readPrivateFile(keyPath, 32);
            if (this.key.length !== 32)
                throw new Error("Invalid local storage key");
        } catch (error) {
            rmSync(this.lockPath, { force: true });
            throw error;
        }
    }
    load(): T {
        if (this.closed) throw new Error("Buyer store closed");
        if (!existsSync(this.statePath)) return this.empty();
        const envelope = JSON.parse(
            readPrivateFile(this.statePath, 12 * 1024 * 1024).toString("utf8"),
        ) as { iv: string; tag: string; ciphertext: string };
        const decipher = createDecipheriv(
            "aes-256-gcm",
            this.key,
            Buffer.from(envelope.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, "base64")),
            decipher.final(),
        ]);
        try {
            if (plaintext.byteLength > 8 * 1024 * 1024)
                throw new Error("Local buyer storage capacity exceeded");
            return this.decode(JSON.parse(plaintext.toString("utf8")));
        } finally {
            plaintext.fill(0);
        }
    }
    save(value: T): void {
        if (this.closed) throw new Error("Buyer store closed");
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const plaintext = Buffer.from(JSON.stringify(value));
        if (plaintext.byteLength > 8 * 1024 * 1024) {
            plaintext.fill(0);
            throw new Error("Local buyer storage capacity exceeded");
        }
        const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
        ]);
        plaintext.fill(0);
        const temporary = join(
            this.directory,
            `requests.${randomBytes(8).toString("hex")}.tmp`,
        );
        const descriptor = openSync(
            temporary,
            constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
            0o600,
        );
        try {
            writeFileSync(
                descriptor,
                JSON.stringify({
                    iv: iv.toString("base64"),
                    tag: cipher.getAuthTag().toString("base64"),
                    ciphertext: ciphertext.toString("base64"),
                }),
            );
            fsyncSync(descriptor);
        } finally {
            closeSync(descriptor);
        }
        renameSync(temporary, this.statePath);
        chmodSync(this.statePath, 0o600);
        const directory = openSync(this.directory, constants.O_RDONLY);
        try {
            if (!fstatSync(directory).isDirectory())
                throw new Error("Invalid buyer directory");
            fsyncSync(directory);
        } finally {
            closeSync(directory);
        }
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.key.fill(0);
        rmSync(this.lockPath, { force: true });
    }
}
