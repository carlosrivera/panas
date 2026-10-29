# Faithful PR27 port — checkpoint

This supersedes the initial warm landing styling and an uncommitted approximate dark interpretation. Source: erickrico PR27 head e62b74249007e424b352872647ef26e7fa1d9dc1. The reference PR is not modified or closed.

The actual prototype markup is adapted to JSX in app/page.tsx. app/pr27.css contains the original CSS, with selectors scoped so it cannot impose hero/nav rules on live directory and guide content. Hero/nav76px/dock150px calculations, original fonts/fallback, copy, wire label, window title and positioning, section/table geometry and dialog are retained. components/pr27-runtime.js retains the original WebGL shader, glyph atlas, luma capture, decode/hover/focus/reduced-motion behavior. React lifecycle cleanup is added; no substitute ASCII or artwork is used.

Routing placeholders now point to real directory/buyer/provider routes and MCPWire source. The dock note states prototype/fixed test credits. Concept use-case sections are labeled planned; current single-model/test-credit and uncertain-settlement limitations are explicit. Added wire role/landmark markup does not change geometry. The production directory and setup guides retain their functioning typed API, conservative lease timing, permission/configuration boundaries and shared dark tokens.

## Like-for-like fidelity verification

Original HTML served unmodified by the root review server at127.0.0.1:6768. Port atlocalhost3334. Both rendered in the same agent-browser0.15.2 engine/session isolation at1511x838,360x838,390x838,768x838. Captured nav, main, h1, wire, dock, CTA and all three clip rectangles plus font/gap/padding/letter-spacing/display. All measured element objects are exactly equal at each width. All four port document widths equal viewport width. This establishes layout fidelity in that engine, not video playback or every-browser pixel equivalence.

Evidence: /Users/carlos/code/panas/.panas/website-qa/fidelity/comparison.json and paired original-{width}.png / port-{width}.png. The pair at1511 was visually inspected side by side; only required prototype annotation differs in the first viewport. Different engines can have different font metrics; comparisons do not mix native IAB and headless geometry.

## Outstanding gate

At this checkpoint the fetched PR contains only four original prototype files and no media file. The original video src /video.mp4 and original renderer are preserved while the owner/root locates the uploaded asset. No invented fallback is presented. Media playback, final accessibility checks and deployed-site smoke must be completed against the supplied clip and final deployment before #15 is accepted. No screen-reader session or physical two-device inference claim is made.
