import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { encryptDescriptor, decryptDescriptor } from "./crypto";
const value = {
    providerId: randomUUID(),
    startupId: randomUUID(),
    providerKeyId: "a".repeat(64),
    providerPublicKeyPem: "fixture-public-key".repeat(4),
    ticket: `wire://${"b".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
};
it("encrypts private descriptors with authenticated encryption and rejects tampering", () => {
    const key = randomBytes(32),
        cipher = encryptDescriptor(value, key);
    expect(cipher).not.toContain("wire://");
    expect(decryptDescriptor(cipher, key)).toEqual(value);
    const altered = Buffer.from(cipher, "base64");
    altered[30] = (altered[30] ?? 0) ^ 1;
    expect(() => decryptDescriptor(altered.toString("base64"), key)).toThrow();
    expect(() => decryptDescriptor(cipher, randomBytes(32))).toThrow();
});
