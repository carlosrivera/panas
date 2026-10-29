# Landing prototype (scaffolding)

Standalone HTML prototype of the minimal landing direction designed in Paper (file "Panas", page "Hero — minimal"). It is **not** the shipped site: `apps/web` remains the Next.js app, and this page is a reference to port from.

It contains the hero with three ASCII handshake windows (a WebGL shader over a short clip, played once on hover of the CTA), a sticky curved CTA dock that opens a "pick a side" dialog (seek / expose), and two use-case sections.

## Run

The clip is not committed. Provide your own MP4 either as `prototypes/landing/video.mp4` (ignored by Git) or via `VIDEO`:

```sh
VIDEO=/absolute/path/to/clip.mp4 PORT=6767 node prototypes/landing/server.mjs
```

Open http://localhost:6767. Avoid port 6666; Chromium blocks it as unsafe.

## Copy caveats

Several rows describe planned behaviour (multi-provider fan-out, second-opinion checks, bigger paid models, listing a Mac for money). They are not implemented, and accounting uses test credits only. Free-by-default pricing also requires a provider-side default that does not exist yet. Resolve these before any of this copy ships in `apps/web`.
