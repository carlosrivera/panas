import Link from "next/link";
import type { Metadata } from "next";
import {
    CodeSample,
    GuideLayout,
    GuideNotice,
    GuideSection,
} from "../../../components/guide-layout";
export const metadata: Metadata = { title: "Connect a buyer agent" };
const ownerTemplate = `{
  "buyerId": "OWNER_ENROLLED_BUYER_UUID",
  "sessionId": "OWNER_SELECTED_SESSION_UUID",
  "privateKeyPath": "/absolute/private/buyer-ed25519.pem",
  "dataDir": "/absolute/private/panas-buyer-data",
  "accountingUrl": "https://ACCOUNTING_HOST",
  "registryUrl": "https://REGISTRY_HOST",
  "discoveryTokenPath": "/absolute/private/discovery-token",
  "platformPublicKeyPath": "/absolute/private/platform-public.pem",
  "limits": {
    "maxRequestAtomic": "100",
    "maxSessionAtomic": "1000",
    "maxDailyAtomic": "2000"
  }
}`;
const mcpTemplate = `{
  "mcpServers": {
    "panas": {
      "command": "/absolute/path/to/panas/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/panas/apps/buyer-mcp/src/cli.ts"],
      "env": {
        "PANAS_BUYER_CONFIG": "/absolute/private/buyer-config.json"
      }
    }
  }
}`;
const tools = [
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
            description="The local Panas MCP facade gives your agent one stable connection for discovery, fixed quotes, inference, and receipt retrieval. This website is not part of checkout."
            sections={[
                { id: "prepare", label: "Prepare your client" },
                { id: "owner", label: "Set owner authority" },
                { id: "connect", label: "Connect the facade" },
                { id: "use", label: "Use the seven tools" },
                { id: "recover", label: "Recover safely" },
            ]}
        >
            <GuideSection
                id="prepare"
                number="01"
                title="Prepare the local tools."
            >
                <p>
                    Use a Panas repository checkout with Node.js 24 and the
                    repository-pinned pnpm version, currently 12.16.1. Your MCP
                    client must support local stdio servers. Ollama is required
                    on the provider’s Mac, not on the buyer.
                </p>
                <CodeSample label="Run from the Panas checkout">{`node --version
pnpm --version
pnpm install --frozen-lockfile`}</CodeSample>
                <p>
                    The checked-out source is the supported setup path.
                    Repository access may require an invitation from the
                    prototype operator.
                </p>
            </GuideSection>
            <GuideSection
                id="owner"
                number="02"
                title="Keep spending authority with the owner."
            >
                <p>
                    An operator enrolls your Ed25519 public key, creates the
                    buyer session, and funds test credits separately. Ask for
                    the registry/accounting addresses, pinned platform public
                    key, and a read-only discovery credential through a private
                    channel. There is no self-serve enrollment or real-money
                    purchase flow on this site.
                </p>
                <GuideNotice title="One integer unit is one test credit.">
                    <p>
                        Quotes are fixed per successful bounded request. Token
                        counts are diagnostic, not the billing unit. The example
                        caps below are owner configuration—not a price offer or
                        a credit balance. Local and cloud limits both apply.
                    </p>
                </GuideNotice>
                <p>
                    Create the owner configuration outside version control. It
                    and every referenced key/credential file must be owner-owned
                    regular files with mode <code>0600</code>. The dedicated
                    data directory must be mode <code>0700</code>. Replace every
                    uppercase identity/host placeholder and every example path
                    before using this template.
                </p>
                <CodeSample label="Owner configuration template — replace placeholders">
                    {ownerTemplate}
                </CodeSample>
                <p>
                    Only the owner edits identities, keys, session IDs, and
                    spending limits. The agent cannot raise them through MCP
                    tools. Daily caps use UTC; session and daily authority count
                    gross completed charges even after refunds.
                </p>
            </GuideSection>
            <GuideSection
                id="connect"
                number="03"
                title="Add one MCP server to your client."
            >
                <p>
                    Point the client at the installed workspace <code>tsx</code>{" "}
                    executable and the buyer facade entry point. Use real
                    absolute paths on the buyer’s computer. The environment
                    contains the private configuration path, not a pasted key or
                    provider ticket.
                </p>
                <CodeSample label="MCP client configuration template — absolute paths required">
                    {mcpTemplate}
                </CodeSample>
                <p>
                    Reload your client’s MCP configuration. You should see seven
                    Panas tools. Provider discovery and handoff happen behind
                    this stable interface; you do not install a new MCP server
                    for each provider.
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
                    aria-label="Seven buyer MCP tools"
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
