/** Offline wallet generation only. Never signs/broadcasts a payment or prints a secret. */
import { mkdir, writeFile, lstat, readFile } from "node:fs/promises";
import { resolve, join, dirname, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import {
    address,
    generateKeyPair,
    writeKeyPair,
    createKeyPairFromBytes,
    getAddressFromPublicKey,
} from "@solana/kit";
import {
    findAssociatedTokenPda,
    TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { DEVNET_USDC_MINT } from "../../packages/contracts/src/payments.js";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
async function main() {
    const { values } = parseArgs({ options: { out: { type: "string" } } });
    if (!values.out || !isAbsolute(values.out))
        throw new Error("Use a new absolute private --out directory");
    const directory = resolve(values.out);
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    await mkdir(directory, { mode: 0o700 }); // Existing treasury directories are never overwritten.
    const result: Record<string, unknown> = {
        custody: "local-software-keys",
        productionCustodyReady: false,
        mainnetPaymentsEnabled: false,
        onChainAccountsCreated: false,
    };
    for (const [network, mint] of [
        ["mainnet-candidate", MAINNET_USDC_MINT],
        ["devnet", DEVNET_USDC_MINT],
    ] as const) {
        const folder = join(directory, network);
        await mkdir(folder, { mode: 0o700 });
        const keyPair = await generateKeyPair(true);
        const walletAddress = await getAddressFromPublicKey(keyPair.publicKey);
        const keypairPath = join(folder, "keypair.json");
        await writeKeyPair(keyPair, keypairPath);
        if ((await lstat(keypairPath)).mode & 0o077)
            throw new Error("Treasury key permissions are not private");
        const restored = await createKeyPairFromBytes(
            Uint8Array.from(JSON.parse(await readFile(keypairPath, "utf8"))),
        );
        if (
            (await getAddressFromPublicKey(restored.publicKey)) !==
            walletAddress
        )
            throw new Error("Treasury restore verification failed");
        const challenge = new TextEncoder().encode(
            "Panas local key restore check; not a transaction",
        );
        const signature = await crypto.subtle.sign(
            "Ed25519",
            restored.privateKey,
            challenge,
        );
        if (
            !(await crypto.subtle.verify(
                "Ed25519",
                restored.publicKey,
                signature,
                challenge,
            ))
        )
            throw new Error("Treasury key pair verification failed");
        const [usdcTokenAccount] = await findAssociatedTokenPda({
            owner: walletAddress,
            mint: address(mint),
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        result[network] = {
            walletAddress,
            usdcMint: mint,
            usdcTokenAccount,
            keypairPath,
        };
    }
    await writeFile(
        join(directory, "treasury-public.json"),
        JSON.stringify(result, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
    );
    await writeFile(
        join(directory, "README.txt"),
        "These are real, separate Solana software keypairs. No on-chain account was created or funded. The mainnet candidate is NOT production-ready custody on this unsandboxed demo Mac. Keep both keypair.json files private. Back them up in an encrypted offline location and verify restoration before any use. Never paste/upload key files into chat, Git, a model prompt or a provider environment. Use a hardware-backed or multisig treasury before holding real funds. The demo uses ONLY the separate devnet key; Panas mainnet payments remain disabled.\n",
        { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify(result, null, 2));
}
void main().catch(() => {
    console.error(
        "Treasury generation failed; existing keys were not overwritten. Inspect the private directory locally before retrying. No secrets were logged.",
    );
    process.exitCode = 1;
});
