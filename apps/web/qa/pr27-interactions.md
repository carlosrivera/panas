# Merged PR27 non-video interaction sync

Source: merged `prototypes/landing/index.html` at `4b9ff77`, on main `1e022ae`. This follow-up copies the newer source interactions into the existing faithful Next.js port. It does not reinterpret the design, enable video, or change discovery/accounting behavior.

## Changes

- Original four-second `packet-out`, `packet-in`, `pill-blip`, `mac-ping`, and `agent-ack` keyframes, scoped element selectors, and original reduced-motion rules. Keyframe steps themselves remain unprefixed and unchanged.
- Original agent/mac and outbound/inbound class names in the wire markup.
- Original draggable-window cursor/touch styles, transform offsets, last-grabbed stacking and 48px keep-visible bounds. Dragging remains decorative; original aria-hidden treatment is retained.
- Pointer listeners use the port's existing abort controller. Effect cleanup also clears an active dragging class/state. Original drag calculations are unchanged.

Video remains `data-src`; the merged prototype's supplied clip is not copied into public assets or loaded. Both comparison pages defer video, so no clip decoding/playback evidence is claimed.

## Verification

Frozen install, `pnpm format:check`, web typecheck, root lint, and isolated production webpack build pass. Full `pnpm check` also passes: all typechecks, 102 tests passed (19 gated tests skipped), and the production build. No hardware, payment, or media test was inferred from skipped tests.

Compared the actual merged prototype and production Next port in the same browser at 1511×838, 360×838, 390×838 and 768×838. Desktop sampled six animation times: 0, 840, 1000, 1960, 3000 and 3840ms. Responsive samples use 1000ms. Animation transforms, shadows, colors, packet positions/opacity, original geometry, and window cursor/touch styles match across all nine samples. The unchanged app baseline has CTA `touch-action: manipulation` versus the standalone prototype's `auto`; raw evidence preserves this exception rather than claiming complete style identity.

Native browser pointer input verified:

- Trusted pointerdown captures the pointer and displays the grabbing state.
- A +120/+60 gesture produces exactly the corresponding transform; pointerup releases capture and further movement leaves position unchanged.
- Last-grabbed window is last among siblings, with window z-index0 beneath copy z-index1.
- Native right/top movement reaches the original viewport clamp. Initial responsive layouts have no horizontal overflow; deliberate offscreen dragging retains the source's partial-window behavior.

A synthetic pointercancel verified that handler clears dragging and stops motion; this is not a native OS cancellation claim. A separate real-browser fixture loads the actual exported runtime against the source DOM, calls its cleanup while dragging, and verifies that later pointer movement cannot change the transform and no grabbing state remains. This verifies lifecycle cleanup, not a second production deployment.

The normal packet animation advances on the native animation clock. Under reduced motion, both original and port expose zero animations, hidden packet opacity0 and no pill transform. Direct pointer dragging still works without animated interpolation. Clip windows remain hidden below1100px. No video resource request occurred.

Homepage axe-core4.14 checks at 1511/768/360 report zero detected WCAG2/2.1 A/AA and best-practice violations; no full conformance or screen-reader session is claimed. The existing native dialog still closes on Escape and returns focus to the CTA.

Artifacts outside Git: `/Users/carlos/code/panas/.panas/website-qa/interactions/` contains paired original/port captures, motion-comparison.json (including the baseline exception), drag.json, reduced-motion.json and a11y.json.

All work used `/Users/carlos/code/panas-worktrees/landing-interactions`, independent of the production3333 checkout. The app registration restriction prevented managed creation; an authorized manual Git worktree was used. Existing3333 and live cloud deployment were not modified. Review/merge/deployment of this follow-up remain separate gates; #8 stays open until they are verified. Video remains explicitly deferred by the user.
