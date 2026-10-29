import Link from "next/link";
import type { Metadata } from "next";
import {
    CodeSample,
    GuideLayout,
    GuideNotice,
    GuideSection,
} from "../../../components/guide-layout";
export const metadata: Metadata = { title: "Prepare a provider Mac" };
const runtimeTemplate = `export PANAS_PROVIDER_ID='<operator-enrolled-uuid>'
export PANAS_OLLAMA_BINARY='/absolute/path/to/ollama'
export PANAS_MODELS_PATH='/absolute/path/to/dedicated/models'
export PANAS_MODEL_DIGEST='<full-sha256-digest>'
export PANAS_OLLAMA_VERSION='<approved-exact-version>'
export PANAS_DATA_PATH='/absolute/private/panas-provider'
export PANAS_OLLAMA_ENDPOINT='http://127.0.0.1:11536'
pnpm --filter @panas/provider run doctor`;
const hostTemplate = `export PANAS_PROVIDER_PRIVATE_KEY_PATH='/absolute/private/provider-ed25519.pem'
export PANAS_PLATFORM_PUBLIC_KEY_PATH='/absolute/private/platform-public.pem'
export PANAS_REGISTRY_URL='https://REGISTRY_HOST'
export PANAS_ACCOUNTING_URL='https://ACCOUNTING_HOST'
export PANAS_PRICE_VERSION='1'
export PANAS_PRICE_ATOMIC='10'
pnpm --filter @panas/provider-mcp run host`;
export default function ProviderGuide() {
    return (
        <GuideLayout
            audience="Provider"
            title="Give your spare compute a useful connection."
            description="Prepare an Apple Silicon Mac to serve one approved small model natively. The controller tests capabilities before advertising readiness and keeps inference separate from peer connections."
            sections={[
                { id: "prepare", label: "Prepare the Mac" },
                { id: "model", label: "Download explicitly" },
                { id: "test", label: "Pin and test" },
                { id: "share", label: "Start the host" },
                { id: "operate", label: "Operate and recover" },
            ]}
        >
            <GuideSection
                id="prepare"
                number="01"
                title="Start with a supported Mac."
            >
                <p>
                    The prototype targets Apple Silicon and macOS 14 or newer,
                    with Node.js 24, the pinned pnpm 12.16.1, and an
                    operator-approved Ollama revision. Install from a Panas
                    checkout and enroll the provider ID and Ed25519 public key
                    with the operator before publication.
                </p>
                <CodeSample label="Run from the Panas checkout">{`node --version
pnpm --version
pnpm install --frozen-lockfile`}</CodeSample>
                <p>
                    Keep private keys and application state outside version
                    control. Use a dedicated models directory and an unused
                    loopback port. Panas refuses to adopt or stop an existing
                    Ollama service.
                </p>
                <p>
                    <a
                        href="https://docs.ollama.com/macos"
                        className="text-link"
                    >
                        Official Ollama macOS requirements ↗
                    </a>
                </p>
            </GuideSection>
            <GuideSection
                id="model"
                number="02"
                title="Download the small model deliberately."
            >
                <p>
                    The initial approved model is <code>qwen2.5:0.5b</code>. Set
                    up the operator-approved Ollama runtime with the dedicated
                    model directory first. Panas will not download a missing
                    model during launch tests.
                </p>
                <CodeSample label="Terminal 1 — temporary setup runtime template">{`OLLAMA_MODELS='/absolute/path/to/dedicated/models' \\
OLLAMA_HOST='127.0.0.1:11536' \\
OLLAMA_NO_CLOUD=1 \\
'/absolute/path/to/approved/ollama' serve`}</CodeSample>
                <CodeSample label="Terminal 2 — explicit download into that runtime">{`OLLAMA_HOST='127.0.0.1:11536' \\
'/absolute/path/to/approved/ollama' pull qwen2.5:0.5b
curl --fail http://127.0.0.1:11536/api/tags`}</CodeSample>
                <p>
                    This command talks to the Ollama server selected by your
                    setup environment. Confirm it uses the dedicated directory;
                    a model downloaded into another server’s directory does not
                    prepare the Panas instance. See{" "}
                    <a
                        href="https://docs.ollama.com/faq"
                        className="inline-link"
                    >
                        Ollama’s model-directory and host configuration
                    </a>
                    .
                </p>
                <p>
                    Obtain the full digest from that runtime’s{" "}
                    <code>/api/tags</code> response and the exact approved
                    runtime version. Stop the temporary setup runtime before
                    letting Panas own its configured process. Never paste a
                    digest from an unrelated model revision.
                </p>
            </GuideSection>
            <GuideSection
                id="test"
                number="03"
                title="Pin the runtime and run local checks."
            >
                <p>
                    Set the explicit configuration below using your enrolled
                    identity, real absolute paths, full model digest, and
                    approved version. The examples are templates; replace
                    placeholders before executing them.
                </p>
                <CodeSample label="Local capability-check configuration template">
                    {runtimeTemplate}
                </CodeSample>
                <p>
                    The doctor checks platform, memory/disk, runtime/model pins,
                    bounded inference, limits, exposure, and cancellation. A
                    local pass means{" "}
                    <strong>testing / connectivity unverified</strong>, not
                    ready. A current separate-peer probe is still required.
                </p>
                <GuideNotice title="Bounded inference, not unrestricted device access.">
                    <p>
                        The prototype profile allows one active request, a queue
                        of two, up to 2,048 context tokens, up to 128 output
                        tokens, and a 60-second generation deadline. Admission
                        uses conservative input bounds. It does not promise hard
                        GPU or unified-memory partitioning, hostile-code
                        isolation, or independently verified token counts.
                    </p>
                </GuideNotice>
            </GuideSection>
            <GuideSection
                id="share"
                number="04"
                title="Start the persistent paid host."
            >
                <p>
                    After operator enrollment, add the provider key, pinned
                    platform key, actual service addresses, and your versioned
                    fixed test-credit price. Keep the runtime configuration from
                    step 3 in the same environment. The sample price is an
                    example, not a platform offer.
                </p>
                <CodeSample label="Host configuration template — operator values required">
                    {hostTemplate}
                </CodeSample>
                <p>
                    The controller owns the model worker, launches MCPWire,
                    verifies the startup through a separate local-peer round
                    trip, signs registration, and sends heartbeats. It uploads
                    connection material privately; public listings do not
                    contain tickets or grants.
                </p>
                <p>
                    The local-peer probe does not prove that every remote
                    network can reach your Mac. Availability can change between
                    discovery and admission. Signed capability reports identify
                    their source; they are provider assertions, not hardware
                    attestation.
                </p>
                <GuideNotice title="Keep connection and workload data private.">
                    <p>
                        Private key files must be mode <code>0600</code> or more
                        restrictive. Do not publish connection tickets or use
                        unmanaged MCPWire recordings for paid envelopes.
                        Encrypted transport does not prevent you, as the
                        provider, from inspecting workloads on your Mac.
                    </p>
                </GuideNotice>
            </GuideSection>
            <GuideSection
                id="operate"
                number="05"
                title="Know when readiness must change."
            >
                <p>
                    Keep the host process running while sharing. Stop it with
                    Ctrl+C to end the session and its owned runtime. Do not
                    start a second controller against the same private data
                    path. Administrative pause/resume/drain operations exist on
                    private local IPC; this website does not expose device
                    controls.
                </p>
                <div className="guide-faq">
                    <details>
                        <summary>
                            A check fails or the model is missing.
                        </summary>
                        <p>
                            Read the local diagnostic, verify the approved pins
                            and dedicated model directory, and explicitly fix
                            setup. Failed checks keep the provider unavailable.
                            There is no silent model pull or automatic adoption
                            of another server.
                        </p>
                    </details>
                    <details>
                        <summary>
                            The Mac sleeps or a model/runtime changes.
                        </summary>
                        <p>
                            A health gap longer than 45 seconds or changed pins
                            invalidates readiness. Recovery requires fresh tests
                            and a fresh peer proof. The current guard handles
                            process-suspension gaps; it is not a native macOS
                            power-event listener.
                        </p>
                    </details>
                    <details>
                        <summary>A buyer disconnects during inference.</summary>
                        <p>
                            The disposable peer adapter can close while the
                            persistent daemon retains the original request and
                            terminal outcome. A buyer retrieves that request
                            after reconnecting. Do not rerun uncertain work or
                            infer settlement from a socket closing.
                        </p>
                    </details>
                    <details>
                        <summary>A running request is cancelled.</summary>
                        <p>
                            Cancellation terminates the dedicated runtime
                            fail-safe, invalidates readiness, and requires
                            retesting plus a peer probe before new work. The
                            durable terminal decision goes to accounting; the
                            buyer’s cancellation request alone does not release
                            a hold.
                        </p>
                    </details>
                </div>
                <a
                    className="text-link"
                    href="https://github.com/carlosrivera/panas/blob/main/apps/provider-mcp/README.md"
                >
                    Maintained host setup documentation ↗
                </a>
                <br />
                <a
                    className="text-link"
                    href="https://github.com/carlosrivera/panas/blob/main/apps/provider/README.md"
                >
                    Runtime and capability details ↗
                </a>
                <p className="small-note">
                    Repository access may be required. Self-serve enrollment and
                    real-money payments are not available in this prototype.
                </p>
                <Link href="/providers" className="text-link">
                    Inspect public provider reports →
                </Link>
            </GuideSection>
        </GuideLayout>
    );
}
