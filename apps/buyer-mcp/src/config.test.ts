import { afterEach, expect, it } from "vitest";
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readOwnerConfig } from "./config";
import { PrivateStore } from "./store";
const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0))
        rmSync(dir, { recursive: true, force: true });
});
const temporary = () => {
    const dir = mkdtempSync(join(tmpdir(), "panas-buyer-"));
    dirs.push(dir);
    return dir;
};
it("rejects world-readable owner configuration and does not accept tool-controlled authority fields", () => {
    const dir = temporary();
    const path = join(dir, "config.json");
    const config = {
        buyerId: randomUUID(),
        sessionId: randomUUID(),
        privateKeyPath: join(dir, "key"),
        dataDir: join(dir, "data"),
        accountingUrl: "https://account.test",
        registryUrl: "https://registry.test",
        discoveryTokenPath: join(dir, "token"),
        platformPublicKeyPath: join(dir, "platform.pem"),
        limits: {
            maxRequestAtomic: "10",
            maxSessionAtomic: "20",
            maxDailyAtomic: "30",
        },
    };
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    expect(readOwnerConfig(path).limits.maxRequestAtomic).toBe("10");
    chmodSync(path, 0o644);
    expect(() => readOwnerConfig(path)).toThrow();
    chmodSync(path, 0o600);
    writeFileSync(
        path,
        JSON.stringify({ ...config, toolMayIncreaseBudget: true }),
    );
    expect(() => readOwnerConfig(path)).toThrow();
});
it("encrypts all state and preserves it across facade restarts without a second writer", () => {
    const dir = temporary();
    const decode = (value: unknown) =>
        value as { prompt: string; ticket: string; grant: string };
    const initial = () => ({ prompt: "", ticket: "", grant: "" });
    const first = new PrivateStore(dir, decode, initial);
    const value = {
        prompt: "private prompt",
        ticket: "private ticket",
        grant: "private grant",
    };
    first.save(value);
    const encrypted = readFileSync(join(dir, "requests.enc"), "utf8");
    for (const secret of Object.values(value))
        expect(encrypted).not.toContain(secret);
    expect(() => new PrivateStore(dir, decode, initial)).toThrow();
    first.close();
    const second = new PrivateStore(dir, decode, initial);
    expect(second.load()).toEqual(value);
    second.close();
});
it("fails closed on encrypted state modification", () => {
    const dir = temporary();
    const store = new PrivateStore(
        dir,
        (value) => value,
        () => ({}),
    );
    store.save({ spent: "100" });
    const path = join(dir, "requests.enc");
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    envelope.tag = Buffer.alloc(16).toString("base64");
    writeFileSync(path, JSON.stringify(envelope));
    expect(() => store.load()).toThrow();
    store.close();
});
