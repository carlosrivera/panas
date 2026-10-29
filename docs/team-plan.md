# Team implementation plan

This plan divides the prototype into reviewable GitHub issues. `docs/issues.json` contains publishable issue bodies; dependency references link to published GitHub issues. Published issue links appear below; ownership lanes are recommendations, not GitHub assignments.

The foundation team owns the first issue and supplies shared contracts, tooling, CLI boundaries, launch skeleton, health-function scaffold, and CI. Follow-up owners complete runtime behavior and integrations. Generated deployment configuration is deployment-ready scaffolding, not evidence that a cloud project is live.

## Issue map

| Key | Issue                                                                                                                        | Lane               | Prerequisites              |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------- |
| F1  | [Foundations: pnpm workspace, shared contracts, CLI boundaries, and CI](https://github.com/carlosrivera/panas/issues/1)      | Foundation owners  | None                       |
| F2  | [Provider: implement macOS capability tests and persistent inference daemon](https://github.com/carlosrivera/panas/issues/2) | Provider lane      | F1                         |
| F3  | [Transport: supervise external MCPWire share/join lifecycle](https://github.com/carlosrivera/panas/issues/3)                 | Transport lane     | F1                         |
| F4  | [Registry: live provider discovery API and MCP tools on Volcano](https://github.com/carlosrivera/panas/issues/4)             | Control-plane lane | F1                         |
| F5  | [Accounting: fixed quotes, atomic test-credit reservations, and receipts](https://github.com/carlosrivera/panas/issues/5)    | Accounting lane    | F1, F4                     |
| F6  | [Host MCP: buyer-bound authorization and daemon-backed inference tools](https://github.com/carlosrivera/panas/issues/6)      | Host/auth lane     | F1, F2, F5, F3             |
| F7  | [Buyer MCP: automatic discovery-to-inference provider handoff](https://github.com/carlosrivera/panas/issues/7)               | Buyer lane         | F1, F4, F5, F3, F6         |
| F8  | [Website: informational provider listing backed by safe registry data](https://github.com/carlosrivera/panas/issues/8)       | Frontend lane      | F1, F4                     |
| F9  | [Volcano: deploy control plane, discovery interface, and frontend](https://github.com/carlosrivera/panas/issues/9)           | Platform lane      | F1, F4, F5                 |
| F10 | [Integration: two-Mac agent demo and transaction failure matrix](https://github.com/carlosrivera/panas/issues/10)            | Integration lane   | F2, F3, F4, F5, F6, F7, F9 |

Keys F1–F10 are planning keys, not GitHub issue numbers.

## Parallel execution

1. **Foundation:** F1 establishes a reviewed shared baseline. Close it only against checks and an explicit delivered-scope list.
2. **First parallel wave:** F2 provider runtime, F3 transport lifecycle, and F4 registry can proceed independently after F1. Agree contract changes early; use fixtures for missing dependencies.
3. **Second wave:** F5 accounting starts against F4’s service/contracts; F8 frontend consumes F4’s safe projection. F9 platform deployment starts early feasibility work and completes once F4/F5 services exist.
4. **Host and buyer integration:** F6 host/auth completes after F2/F3/F5. F7 buyer facade can scaffold against contracts earlier but completes only with F3/F4/F5/F6.
5. **Demo gate:** F10 integrates actual Macs, MCPWire, Volcano, accounting, and the buyer facade. A passing mock demo does not satisfy this gate.

## Ownership and review boundaries

- Shared schemas and error contracts belong to the foundation baseline; each lane proposes extensions with consumer review rather than maintaining independent payload shapes.
- The provider daemon owns model execution and device-wide state. The host MCP server is disposable and owns protocol/authentication translation.
- The transport package owns process control and output parsing. Business logic must not import MCPWire internals or copy transport code into buyer/provider applications.
- Registry readiness is computed from fresh capability evidence and heartbeat expiry at read/admission time; a cleanup job is not the source of truth.
- Accounting owns quote/ledger policy. Buyer and provider enforce authorized bounds without maintaining competing balance calculations.
- The informational frontend consumes a safe read projection and is outside the required buyer transaction.
- Real-money/blockchain work is a later explicit issue once the test-credit transaction, refund behavior, and payout policy are proven.

## Completion evidence

Each implementation PR links its issue, states what changed, records relevant tests, and calls out remaining mocked boundaries. Required boundary checks include stale readiness, identity binding, atomic concurrent reservation, replay/idempotency, per-device admission, cancellation races, process teardown, and authenticated reconnect retrieval. Record actual hardware/cloud evidence separately from deterministic fixture tests.

## Common defaults

Use a pinned small approved model (initial proposal `qwen2.5:0.5b`) on macOS/Apple Silicon, one active request, queue depth two, 2,048 context tokens including template overhead, 128 output tokens, and a 60-second execution deadline. Validate these in capability tests before advertising them. Heartbeat defaults are 15 seconds with 45-second expiry. Fixed quotes and all disclosed fees fit within owner-authorized spending caps.
