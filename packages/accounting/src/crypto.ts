import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { descriptorSchema, type Descriptor } from "./types.js";
export function encryptDescriptor(value: Descriptor, key: Buffer): string {
    if (key.length !== 32)
        throw new Error("Descriptor encryption requires256bits");
    const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
    const data = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptDescriptor(value: string, key: Buffer): Descriptor {
    const data = Buffer.from(value, "base64");
    if (data.length < 29 || key.length !== 32)
        throw new Error("Invalid descriptor");
    const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return descriptorSchema.parse(
        JSON.parse(
            Buffer.concat([
                cipher.update(data.subarray(28)),
                cipher.final(),
            ]).toString("utf8"),
        ),
    );
}
