import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { TEST_REGISTRY_URL, TEST_ACCOUNTING_URL } from "./config.js";
it("keeps the second-Mac environment on the reviewed test services and native pins", async () => {
    const env = parseEnv(
        await readFile(
            new URL(
                "../../../docs/integration/provider-mac-b.env.example",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    expect(env.PANAS_REGISTRY_URL).toBe(TEST_REGISTRY_URL);
    expect(env.PANAS_ACCOUNTING_URL).toBe(TEST_ACCOUNTING_URL);
    expect(env.PANAS_OLLAMA_VERSION).toBe("0.40.12");
    expect(env.PANAS_MODEL_DIGEST).toBe(
        "a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67",
    );
    expect(
        Object.keys(env).some((name) =>
            /TOKEN|DATABASE_URL|PRIVATE_KEY_BASE64/.test(name),
        ),
    ).toBe(false);
});
