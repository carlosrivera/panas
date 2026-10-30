# Panas × Codex

Panas lets Codex discover someone else's available compute through MCP, request bounded inference, and retrieve a result with a receipt. The provider runs the pinned small model in Docker; Codex coordinates the buyer's tool calls.

## What Codex helped build

We used Codex as an engineering collaborator for the pnpm workspace and platform foundations, the buyer and provider MCP integration, signed authorization and accounting, Docker provider isolation, crash and reconnect recovery, Volcano deployment tooling, and CLI release packaging. Human collaborators supplied product direction, visual design, and review.

The repository's [architecture](architecture.md), [Docker isolation](docker-sandbox.md), [authorization protocol](authorization-protocol.md), and [integration records](integration/README.md) explain the implementation and its limits.

## Demo walkthrough

Complete the [provider and buyer setup](distribution.md) first. The provider needs an Apple Silicon Mac, Node.js 24, Docker Desktop, the matching release image and model, and enrolled owner configuration. The buyer needs Node.js 24, its owner configuration, and Codex.

1. On the provider computer, start a free provider:

    ```sh
    ~/.local/bin/panas provider --free
    ```

2. On the buyer computer, generate the portable Codex setup prompt:

    ```sh
    ~/.local/bin/panas demo-prompt
    ```

    Paste its output into Codex and follow its MCP setup instructions. Paths are generated for the buyer's installation.

3. Once the MCP tools are available, ask Codex:

    > Use Panas to discover a ready free inference provider. Show its model, limits, and price. Request one short inference within my existing owner policy: “Say hello in one short sentence.” Retrieve the result and receipt, and show the request ID and final charge. Stop if no free provider is ready or my policy does not authorize the request.

4. Show the discovered provider, model output, request ID, and zero-charge receipt. Explain that Codex performed discovery and orchestration while the provider's small model performed the requested inference.

5. Show the provider's Docker gateway and separate worker. The worker has networking disabled; the gateway owns the bounded peer connection. The [sandbox guide](docker-sandbox.md) documents the actual controls and trust boundaries.

## Validation status

This walkthrough is prepared for the demo; it does not record a newly executed run. Alpha.6 publication and subsequent documentation changes kept testing deferred at the owner's request. Existing integration records identify their source revisions and completed checks. Run the remaining acceptance drills before presenting them as verified on the current release.
