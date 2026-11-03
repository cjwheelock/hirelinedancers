# Homepage testing rehearsal

Page: `/homepage-testing/`. Reviewed against production baseline
`79343c9ce1af2885804a20dae92e4732ab634839` on November 3, 2026.

## Scope

One illustrative search, profile, and inquiry story in the existing Hire Line
Dancers brand. The main homepage, backend, accounts, purchase flow, and existing
routes are unchanged. Scene data is local illustration state. The scene has no
real form controls or submission handlers. The illustration is inert and exposes
one accessible description; real playback and step controls remain accessible.

## Checks performed

- Chrome on macOS, production static export, widths 1440, 390, and 320 pixels.
- Wide and compact search, profile, and inquiry states. Desktop and phone
  captures compared with the upstream hero-demo reference.
- Real replay reaches the final inquiry state and its no-submission confirmation.
  Stop and all three static step controls were exercised. Sequential step
  selection exposed and fixed an upstream poster-effect dependency issue.
- Final 320px layout has no horizontal overflow. Its header adjustment is scoped
  to this route with the page's CSS module class.
- Content and actions remain within the stage crop; only decorative filler bleeds.
- An independent fresh-eye reviewer found no material visual issues in the final
  desktop inquiry and 390px search/profile frames. The reviewer did not inspect
  the subsequent 320px header correction; that was checked directly afterward.
- Actual reduced-motion hook passed six lifecycle assertions: initial preference,
  live preference changes both ways, listener cleanup, ordinary playback, and
  static context. Source review confirms the preference stops script playback,
  selects the complete poster, hides the cursor, and disables replay. CSS also
  removes scene transitions and CTA transforms for reduced motion.
- Production build and TypeScript check passed. Lint has warnings but no errors.
  Existing commercial-term audit and 47 approval, auth, journey, and booking
  document tests passed. Static site audit passed for 53 HTML files.
- Content provenance audit is recorded outside the release tree. MIT license
  and source pin are retained alongside the adapted runtime.

## Verification limits

The environment requires browser interaction through its computer-use API, so
Stageshow's headless recording/layout scripts were not run. No film gate or
40ms frame-by-frame pass is claimed. Still captures and normal browser playback
do not prove every animation frame is free of visual defects.

The Mac was locked, preventing native browser DevTools/OS preference control.
Rendered OS reduced-motion toggling and physical-device touch were therefore
not exercised. Reduced motion was checked through the actual hook lifecycle,
the static poster controls, CSS, and playback source. No dark theme is shipped.
