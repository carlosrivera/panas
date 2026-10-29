# Landing and shared visual foundation (#12)

Story: a visitor understands Panas, follows the directory/buyer/provider paths, and sees clear test-credit, workload, and trust boundaries. This slice contains a real landing and shared shell; directory and guide destinations are honest transitional pages, expanded separately in #13/#14.

## Shared foundation

- Routes: `/`, `/providers`, `/guides/buyer`, `/guides/provider`.
- Palette: warm ivory `#faf7ee`, forest `#203d30`, burnt orange `#ad3d23`, muted ink `#5c695e`, card `#fffdf7`, pale green `#e7eddf`.
- Type: system Avenir/Segoe UI body, Iowan/Palatino/Georgia headings, system mono labels. No external font request/build dependency.
- Layout: shared 1,240px shell, 20–48px responsive gutters, fluid section spacing and heading scale. Mobile navigation stays visible without a hamburger.
- Shared primitives: pill button, card/notice surface, tag, eyebrow, text link, 3px visible focus, skip link, header/footer, and `PageIntro`.
- Status remains text-based. The illustration is explicitly labeled prototype, not a live provider listing. No invented totals, quotes, benchmarks, testimonials, or earnings appear.
- Reduced motion disables transitions/animations and smooth scrolling. No essential information depends on animation.

## Local evidence

Inspected the actual browser at 360×900, 768×1024, and 1440×1100. Document scroll width matched viewport at all three sizes. Heading and landmark tree reviewed; skip link is first keyboard stop, shows a solid focus outline, and Enter targets `#main`. All three navigation destinations render and carry distinct page titles. Footer links are reachable and the main navigation uses native links.

Captures are local artifacts (not repository image dependencies):

- `/Users/carlos/code/panas/.panas/website-qa/12/landing-mobile.png`
- `/Users/carlos/code/panas/.panas/website-qa/12/landing-tablet.png`
- `/Users/carlos/code/panas/.panas/website-qa/12/landing-desktop.png`

Computed token contrast: forest/ivory 11.07:1, muted ink/ivory 5.39:1, primary button 5.95:1, footer muted text 8.26:1. These exceed AA normal-text contrast for the measured pairs.

Broader directory/guide states, detailed accessibility, and deployed checks remain #15. No screen-reader session or two-device transaction is claimed here.
