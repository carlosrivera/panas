import Link from "next/link";
import { pageMetadata } from "../../../lib/site-metadata";
import {
    CodeSample,
    GuideLayout,
    GuideQuickStart,
    GuideNotice,
    GuideSection,
} from "../../../components/guide-layout";
export const metadata = pageMetadata(
    "Share your Mac",
    "Start a Docker-isolated Panas provider on your Apple Silicon Mac. Share spare inference capacity for free or a fixed price.",
    "/guides/provider",
);
const runtimeTemplate = `# Save operator-supplied values in ~/.config/panas/provider.env (mode 0600)
PANAS_PROVIDER_ID=<operator-enrolled-uuid>
PANAS_PROVIDER_PRIVATE_KEY_PATH=/absolute/private/provider.pem
PANAS_PLATFORM_PUBLIC_KEY_PATH=/absolute/private/platform-public.pem
PANAS_MODELS_PATH=/absolute/path/to/dedicated/models
PANAS_MODEL_DIGEST=a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67
PANAS_OLLAMA_VERSION=0.40.12
PANAS_REGISTRY_URL=https://panas.mcpwire.co/registry
PANAS_ACCOUNTING_URL=https://panas.mcpwire.co/accounting
PANAS_PRICE_VERSION=free-v1
PANAS_PRICE_ATOMIC=0

~/.local/bin/panas doctor`;
const hostTemplate = `# Free access; identity and signed grants are still required
~/.local/bin/panas provider --free

# Optional fixed-price Solana devnet test-USDC access
~/.local/bin/panas provider --solana-devnet --price-atomic 10000`;
export default function ProviderGuide() {
    return (
        <GuideLayout
            audience="Provider"
            title="Give your spare compute a useful connection."
            description="Share spare compute from your Mac for free, with inference isolated in Docker."
            quickStart={
                <GuideQuickStart
                    command={
                        "curl -fsSL https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.7/install.sh | sh && ~/.local/bin/panas provider --free"
                    }
                >
                    <>
                        <a href="#prepare" className="inline-link">
                            Setup requirements
                        </a>
                        : Node.js 24, Docker Desktop, the approved model and
                        your enrolled provider configuration.
                    </>
                </GuideQuickStart>
            }
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
                    Use Apple Silicon, macOS 14 or newer, Node.js 24 and running
                    Docker Desktop. Install the latest compiled release; no
                    source checkout or container-registry account is required.
                    Enroll the provider UUID and Ed25519 public key with the
                    operator before publication.
                </p>
                <CodeSample label="Download and run the release installer">{`curl --fail --location https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.7/install.sh -o /tmp/panas-install.sh
sh /tmp/panas-install.sh`}</CodeSample>
                <p>
                    Public serving requires a Docker gateway and a separate
                    network-disabled inference worker. Both run non-root with
                    read-only roots and resource caps. No Docker socket, home
                    directory or treasury keys are mounted. Startup verifies the
                    matching image and refuses native fallback. The small model
                    runs on CPU.
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
                    starting Panas. Serving uses the pinned Linux runtime inside
                    Docker, not this temporary host setup process. Never paste a
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
                        uses conservative input bounds. Docker caps the worker
                        at two CPUs, 4 GiB and 256 processes. Its network is
                        disabled and model files are read-only. The gateway has
                        network egress. This is not hardware attestation,
                        confidential inference or independently verified usage.
                    </p>
                </GuideNotice>
            </GuideSection>
            <GuideSection
                id="share"
                number="04"
                title="Start the sandboxed host."
            >
                <p>
                    Keep the operator configuration in its private env file,
                    then choose free access or a fixed devnet test-USDC price.
                    Paid access needs a separately funded devnet-USDC buyer.
                    Never provide a treasury signing key to either container.
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
                    start a second controller against the same provider
                    identity. Retain its Docker state volume when recovering an
                    uncertain request. Administrative pause/resume/drain
                    operations exist on private local IPC; this website does not
                    expose device controls.
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
                    href="https://github.com/carlosrivera/panas/blob/main/docs/docker-sandbox.md"
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
                    Source cloning is not required. Self-serve enrollment and
                    real-money payments are not available in this prototype.
                </p>
                <Link href="/providers" className="text-link">
                    Inspect public provider reports →
                </Link>
            </GuideSection>
        </GuideLayout>
    );
}
