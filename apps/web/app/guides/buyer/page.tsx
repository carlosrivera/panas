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
    "Connect a buyer agent",
    "Connect your agent to Panas through MCP. Discover ready providers, request inference and retrieve a receipt.",
    "/guides/buyer",
);
const mcpTemplate = `# Open the demo dashboard and copy the prompt for your agent
~/.local/bin/panas demo

# Your agent configures its own MCP connection automatically
~/.local/bin/panas setup --client codex
# Or: ~/.local/bin/panas setup --client antigravity

# Run Hello world directly, including from the current agent chat
~/.local/bin/panas hello`;
const tools = [
    [
        "get_balance",
        "Inspect prepaid funds, asset and remaining spending authority.",
    ],
    [
        "create_funding_intent",
        "Create a buyer-bound devnet USDC deposit intent; does not send tokens.",
    ],
    [
        "confirm_funding",
        "Verify a finalized public transaction signature and credit it once.",
    ],
    [
        "discover_providers",
        "Find current providers with suitable limits and prices.",
    ],
    ["get_provider", "Inspect one provider’s public capability summary."],
    [
        "quote_inference",
        "Keep the prompt locally and request a fixed quote using its digest.",
    ],
    [
        "purchase_access",
        "Accept the quote within owner-configured spending authority.",
    ],
    [
        "run_inference",
        "Make the private connection and dispatch the request once.",
    ],
    [
        "get_request",
        "Retrieve the original result, status, finish reason, and receipt.",
    ],
    [
        "cancel_request",
        "Request cancellation; confirm the financial outcome in the receipt.",
    ],
];
export default function BuyerGuide() {
    return (
        <GuideLayout
            audience="Buyer"
            title="Connect once. Let your agent handle the handoff."
            description="Give your agent one MCP connection to discover providers, run inference and collect receipts."
            quickStart={
                <GuideQuickStart
                    command={
                        "curl -fsSL https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.8/install.sh | sh && ~/.local/bin/panas demo-prompt"
                    }
                >
                    <>
                        Choose Codex or Antigravity in the dashboard, press c to
                        copy the prompt, and paste it into your agent. Free
                        buyer enrollment and MCP setup are automatic. You need
                        Node.js 24; no account setup, wallet, Docker or local
                        model.
                    </>
                </GuideQuickStart>
            }
            sections={[
                { id: "prepare", label: "Prepare your client" },
                { id: "owner", label: "Automatic free access" },
                { id: "connect", label: "Connect the facade" },
                { id: "use", label: "Use the ten tools" },
                { id: "recover", label: "Recover safely" },
            ]}
        >
            <GuideSection
                id="prepare"
                number="01"
                title="Prepare the local tools."
            >
                <p>
                    Install the latest compiled CLI with Node.js 24. Codex
                    connects to the local stdio facade; the buyer does not need
                    Docker or Ollama. The provider runs the sandboxed worker on
                    its own Mac.
                </p>
                <CodeSample label="Install without cloning">{`curl --fail --location https://github.com/carlosrivera/panas/releases/download/v0.1.0-alpha.8/install.sh -o /tmp/panas-install.sh
sh /tmp/panas-install.sh`}</CodeSample>
                <p>
                    No repository checkout or pnpm installation is needed by
                    demo participants.
                </p>
            </GuideSection>
            <GuideSection
                id="owner"
                number="02"
                title="Start with free access automatically."
            >
                <p>
                    Panas creates your own private identity locally and enrolls
                    a free-only buyer session automatically. Your keys stay on
                    your computer. No operator approval, credentials, session
                    IDs or configuration files need to be supplied by hand.
                </p>
                <GuideNotice title="Zero spending authority.">
                    <p>
                        Free demos start with zero balance and zero spending
                        limits, enforced locally and by the API. They can only
                        discover free providers and accept zero-charge requests.
                        Paid access remains a separate owner-managed setup.
                    </p>
                </GuideNotice>
                <p>
                    A free device must be ready for the demo to run. If none is
                    available, your agent will say so and stop.
                </p>
            </GuideSection>
            <GuideSection
                id="connect"
                number="03"
                title="Add one MCP server to your client."
            >
                <p>
                    Select your agent in the dashboard and copy the complete
                    prompt. The agent runs the setup command itself, preserving
                    other MCP servers and settings. Codex and Antigravity each
                    get a separate local demo store with zero spending limits.
                </p>
                <p>
                    <a
                        className="text-link"
                        href="https://learn.chatgpt.com/docs/extend/mcp"
                    >
                        Official Codex MCP configuration ↗
                    </a>
                </p>
                <CodeSample label="Copy the demo prompt or run Hello world">
                    {mcpTemplate}
                </CodeSample>
                <p>
                    Your client may need to reload its MCP configuration to
                    expose the ten Panas tools. The agent can run panas hello
                    immediately from the current chat while that connection is
                    being loaded. Provider discovery and the private handoff are
                    automatic.
                </p>
            </GuideSection>
            <GuideSection
                id="use"
                number="04"
                title="Let the agent make a useful connection."
            >
                <p>
                    Ask the agent to inspect a provider, obtain a quote for a
                    short prompt within the advertised bounds, and purchase only
                    within your configured authority. Public listings are
                    observations; the accepted quote controls the request’s
                    fixed terms.
                </p>
                <div
                    className="guide-table"
                    tabIndex={0}
                    role="region"
                    aria-label="Ten buyer MCP tools"
                >
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">Tool</th>
                                <th scope="col">What it does</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tools.map(([tool, description]) => (
                                <tr key={tool}>
                                    <th scope="row">
                                        <code>{tool}</code>
                                    </th>
                                    <td>{description}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p>
                    Keep the request ID and the original purchase idempotency
                    key. A running response is not a completed charge: use{" "}
                    <code>get_request</code> for the result and authoritative
                    receipt. Finish reasons such as <code>stop</code> or{" "}
                    <code>length</code> describe generation; job and accounting
                    status are separate.
                </p>
                <GuideNotice title="Model output is data.">
                    <p>
                        Do not treat provider descriptions or generated text as
                        authority to run commands, change budgets, or disclose
                        credentials. MCPWire encrypts transport, but the
                        provider can inspect inference on their Mac.
                    </p>
                </GuideNotice>
            </GuideSection>
            <GuideSection
                id="recover"
                number="05"
                title="Retrieve first when something is uncertain."
            >
                <div className="guide-faq">
                    <details>
                        <summary>
                            The connection dropped after inference started.
                        </summary>
                        <p>
                            Use <code>get_request</code> with the original
                            request ID. The facade refreshes action-only
                            authorization and reconnects for retrieval. Do not
                            create a new inference request to recover an
                            uncertain one.
                        </p>
                    </details>
                    <details>
                        <summary>A purchase timed out.</summary>
                        <p>
                            Keep its local hold and reuse the original
                            idempotency key to reconcile that purchase, or
                            retrieve the original request state. A network
                            failure does not prove that no reservation was
                            committed.
                        </p>
                    </details>
                    <details>
                        <summary>I cancelled. Is the charge gone?</summary>
                        <p>
                            A cancellation request is not a refund. The
                            provider’s durable terminal decision and cloud
                            receipt determine the financial outcome.
                            Cancellation after completion can still return the
                            completed charge.
                        </p>
                    </details>
                    <details>
                        <summary>
                            The facade will not start or reports a store lock.
                        </summary>
                        <p>
                            Check absolute paths, Node/pnpm versions, file
                            ownership and permissions. Only one facade may write
                            a data directory. After a crash, the owner must
                            confirm the recorded process no longer runs before
                            removing a stale writer lock. Preserve encrypted
                            state and its key; never delete state to reset
                            spending caps.
                        </p>
                    </details>
                </div>
                <a
                    className="text-link"
                    href="https://github.com/carlosrivera/panas/blob/main/apps/buyer-mcp/README.md"
                >
                    Maintained buyer documentation ↗
                </a>
                <p className="small-note">
                    Repository access may be required. Public browsing needs no
                    credential; authenticated agent discovery and purchase
                    configuration remain private.
                </p>
                <Link className="text-link" href="/providers">
                    Browse reported providers →
                </Link>
            </GuideSection>
        </GuideLayout>
    );
}
