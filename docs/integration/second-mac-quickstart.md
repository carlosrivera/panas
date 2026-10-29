# Second Mac: concrete test handoff

Use a second physical Apple Silicon Mac with macOS 14+. This is a manual handoff; the agent cannot access that Mac. The October29 one-Mac crash/startup/rate observations are recorded separately and do not satisfy two-host connectivity or physical sleep.

## 1. Match the tested host release

Install Node.js 24 and pnpm 12.16.1, then on Mac B:

```sh
git clone https://github.com/carlosrivera/panas.git
cd panas
git checkout 281033a964c98a9a173d440030586dd64fb7135b
node --version
pnpm --version
pnpm install --frozen-lockfile
```

This is the verified deployed host/control-plane revision. The newer live-drill harness is a separate test branch; it does not require redeploying Volcano to launch the Mac B provider.

## 2. Install the dedicated runtime/model

Use the [native setup guide](../../apps/provider/README.md). The required runtime is Ollama **0.40.12**, model **qwen2.5:0.5b**, digest **a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67**. Use a dedicated binary bundle and model directory. Copying the approved runtime bundle and model blobs from Mac A is acceptable; copying its private keys or provider state is not. Do not replace the pin with whichever model/runtime version happens to be installed globally. Startup verifies the version/digest and never downloads a model silently.

## 3. Generate a new Mac B identity locally

Run this once in the repository on Mac B. Existing key files are never overwritten:

```sh
node --input-type=module - <<'JS'
import {generateKeyPairSync, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const dir=join(homedir(), '.config', 'panas-mac-b');
mkdirSync(dir,{recursive:true,mode:0o700});
const keys=generateKeyPairSync('ed25519');
writeFileSync(join(dir,'provider.pem'),keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
writeFileSync(join(dir,'provider-public.pem'),keys.publicKey.export({type:'spki',format:'pem'}),{mode:0o600,flag:'wx'});
const providerId=randomUUID();
writeFileSync(join(dir,'provider-id'),providerId+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({providerId,publicKeyFile:join(dir,'provider-public.pem')}));
JS
```

Return only the provider UUID and **public** PEM to the operator on Mac A. Keep `provider.pem` on Mac B. On Mac A, enroll that exact public identity with the existing operator-only environment:

```sh
node --env-file=/private/path/operator.env --import tsx packages/registry/scripts/enroll.ts \
  --provider-id MAC_B_PROVIDER_UUID --public-key-file /private/path/mac-b-public.pem
```

Do not send the operator environment, platform signing key, database credential, buyer key or discovery credential to Mac B. Copy only the pinned **platform public** PEM to Mac B through a trusted channel.

For this test deployment its SHA-256 SPKI fingerprint is `804e30700efdee88a0833bab3fc88c1e13d8591e57c600233d7579ef452c7353`. Compare it on Mac A and Mac B; do not silently accept a different key.

## 4. Configure and launch Mac B

Create a mode0600 `provider.env` under the private directory above, using [provider-mac-b.env.example](provider-mac-b.env.example). Replace every owner/path placeholder with an absolute path; Node's env loader does not expand `~`. Use a fresh `PANAS_DATA_PATH` on Mac B and retain it for restart tests. Both computers may use port11602 because it is their own loopback endpoint.

```sh
chmod 600 "$HOME/.config/panas-mac-b/provider.env"
node --env-file="$HOME/.config/panas-mac-b/provider.env" --import tsx apps/provider-mcp/src/host.ts
```

Leave that terminal running. Require `state: ready` and `peerProbe: verified`. A local separate-peer probe alone does not establish cross-Mac/NAT reachability. If startup refuses an existing listener/owner/guard, inspect ownership rather than deleting state or killing an arbitrary process.

## 5. Run the buyer from Mac A

On Mac A, launch its own enrolled provider with its original private environment. The operator supplies a **fresh, sufficiently funded TEST_CREDIT buyer/session** and mode0600 buyer configuration; do not reuse an expired session or an old locked writer directory. Keep this buyer key and discovery credential on Mac A.

Create the manual configuration from [the full protocol](two-machine.md), with:

- two different provider UUIDs, actually running on Mac A and Mac B;
- aliases `mac-a` / `mac-b` and an honest operator statement that they are distinct physical hosts;
- the verified release evidence JSON, public service URLs and the fresh buyer configuration path.

Then on Mac A:

```sh
pnpm --filter @panas/integration run manual-two-machine --config /private/path/manual.json
```

The buyer must discover both providers and execute on each through its one facade; at least the Mac B request must cross the physical network. Confirm the provider-signed result, one fixed receipt/debit, balanced fees/earnings and no prompt/ticket/grant in public output. Retain the redacted evidence JSON.

## 6. Run physical faults on Mac B

Follow the existing [crash](provider-crash.md), [sleep/wake](provider-sleep-wake.md) and [authorization boundary](authorization-boundaries.md) protocols while the buyer stays on Mac A. Sleep Mac B longer than45 seconds and verify exclusion from ready-only discovery, then fresh tests/startup/probe after wake. For a crash, terminate only its verified owned host PID during observed native generation and restart with the **same** key/data directory. Retrieve the original request; never redispatch unknown work. Keep terminal/receipt and held-reservation checks distinct from transport reconnection.

A deployed Volcano outage needs its separate bounded operator maintenance window; a client-only fault is not that observation. Natural 24-hour expiry needs the unchanged original grant and actual elapsed time; grant renewal does not recreate purged output. Stop the Mac B host with Ctrl-C after testing and retain its private state. Attach the actual two-host observations to #10; no script closes the issue automatically.
