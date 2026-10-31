# Covalent landing page: design

## Current waitlist scope — 2026-10-30

This section supersedes the earlier notes below wherever they differ.

- Render only the hero and closing poster. Keep the middle demo and FAQ source, but
  do not render them or load the middle animation.
- No header: the page opens directly on the hero.
- Hero: “Your team. In sync.”, the email form and the interactive metal mark,
  positioned higher. No eyebrow, explanatory paragraph, captions or scroll cue.
- Typing advances the inner bonds, deletion reverses them, and successful signup
  triggers the terminal-inspired completion mark.
- Feather the transition into the poster. Its heading is “Good work has chemistry.”
  with no eyebrow. Its large wordmark reads `covalent.` in the existing Exposure
  treatment. Hide the Licenses navigation link; retain asset attribution files.
- Product copy is agent-agnostic. Do not reinstate the removed Claude Code-only
  FAQ wording or concept-preview labels. Signup remains a private test integration.

## Earlier design notes

The notes below document the fuller product-site iteration. Process, FAQ and
Explore behaviours are retained for reference, not requirements to restore them.

The current design contract for this app. It replaces everything in `docs/launch-kit/`,
including that kit's limits on one-time motion, a 3D hero, the three-card demo, the
text-path footer and placeholder-safe fonts. The product facts and the waitlist goal from
that kit still stand.

## The idea

**Shared matter.** Separate things stay themselves and hold a real bond. One idea runs
through three moments: the mark (a fixed ring around three moving bonds), the process (two
plates sharing one plane), and the closing poster (two ribbons meeting at one point).

The page stays small. Header, hero, process, three questions, closing poster. No feature
grid, pricing, testimonials or extra calls to action.

Signing up never depends on the story. There is a form in the first viewport and a form at
the end.

## What may be said

Audience: small teams whose coding agents work on the same project. Current focus: teams
using Claude Code. People decide what ships.

Never add customer logos, testimonials, waitlist numbers, launch dates, universal provider
support, guaranteed conflict prevention, or anything implying a finished graphical product.
The process scene is a concept: "Concept preview" sits under it, and the second question
says so in words. The hero stays free of caveats.

## Colour

Defined on `:root` in `src/styles/global.css`.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#faf9f6` | Page |
| `--field` | `#f5f6f7` | Process section |
| `--ink` | `#20242a` | Text, dark controls |
| `--ink-2` | `#3a4049` | Secondary text on light |
| `--muted` | `#626a73` | Body copy |
| `--quiet` | `#68737f` | The second line of a headline |
| `--line`, `--line-strong` | `#dfe1e4`, `#b9bfc6` | Hairlines |
| `--field-line` | `#777f89` | Boundaries that identify a control (3:1) |
| `--cobalt` | `#315cd5` | The one signal: focus, hover, UI agent, success check |
| `--copper` | `#a7702c` | The API agent only |
| `--error` | `#b42336` | Form errors |

Cobalt stays restrained. If it starts decorating things, it has stopped meaning anything.

## Type

- **Exposure** for display, through `--font-display`. Its `EXPO` axis runs heavier as it
  goes negative: -4 for headings, -8 for the header wordmark, -16 for the poster wordmark.
- **Instrument Sans** for body and every control.
- Metric-matched fallbacks in `src/styles/fonts.css` hold the layout while fonts load.

**Exposure is a release blocker.** See "Before anything public" in `README.md`.

## Layout

`--max` 1728px, `--gutter` `clamp(20px, 4.8vw, 96px)`, `--section`
`clamp(72px, 9vw, 128px)`. Nothing in the page is a rounded card.

## Hero

`src/components/Hero.astro`, `src/scripts/hero.ts`, `src/scripts/hero-scene.ts`,
`src/lib/mark-solid.ts`.

- About 47% copy and 53% object on desktop. Below 1000px, copy and form come first, and in
  a short window (200% zoom, a phone on its side) the headline follows the height too, so
  the field and its submit stay in the first view.
- The mark is the exact Covalent silhouette from `src/lib/mark.ts`, built as an analytic
  swept solid rather than an extrusion, so the outline is exact and the faces are crowned.
- The object is lit only by a procedural studio: a bank of softboxes and black flags
  rendered to an environment map. There is no ambient light. Tone mapping is ACES.

| State | Behaviour |
|---|---|
| First load | The poster (`src/assets/mark-poster.png`) is the real scene at its exact arrival pose. The canvas fades in over it, then the poster leaves. Nothing is interactive until the canvas is alone on stage. |
| Rest | A slow float and a very small drift, inside a fraction of a degree. |
| Hover | Bounded, damped tilt, up to 8°. The studio turns slightly against it, so highlights move faster than the object. |
| Drag | Up to 19° of yaw and 15° of pitch. Release settles on a spring with a small overshoot. Touch keeps vertical scrolling. |
| Click, Enter, Space | The inner bonds turn 60°. The ring never spins. The caption swaps. |
| Waitlist submitting | The bonds hop on the terminal's planning cadence, and settle on acceptance. They only ever observe the form. |
| Pause | Ambient motion holds where it is. Direct input still works. |
| Reduced motion | A press turns the bonds at once. No drift, no drag, no arrival sweep. |
| WebGL missing or lost | The poster stays as the hero. No role, no tab stop, no promise of interaction. |

Rendering is on demand: the loop stops whenever nothing can change, off screen, or in a
hidden tab. Resolution follows the measured cost of a frame, using a WebGL2 fence, and is
reset when the window moves to a display with a different pixel ratio.

Regenerate the poster with `tools/render-mark-poster.mjs` whenever geometry, pose or
lighting changes, so the first frame and the poster stay the same picture.

## Process

`src/components/Process.astro`, `src/lib/process-scene.ts`, `src/lib/process-timeline.ts`,
`src/scripts/process.ts`.

`sceneAt(p)` is a pure function from progress to the whole scene, so reversing, reloading
partway and jumping by chapter all land on the same picture. Geometry comes from one
projector at build time.

| Beat | Hold | What changes |
|---|---|---|
| Context | 0.17 | The plates rest on the shared plane. Lines read the brief to both agents. |
| Claims | 0.46 | Plates lift apart, ownership edges and footprints appear, file tabs slide out. |
| Handoff | 0.75 | A line draws from API to UI, and `POST /invites` crosses it. |
| Review | 0.95 | The plates come home to the base together. "Two changes, waiting for a person." Nothing is marked as shipped. |

- Captions swap at 0.25, 0.53 and 0.79.
- The section is 400svh, pinned. Chapter buttons and previous/next are the same story by
  another input. All four beats also exist as text for screen readers.
- Short screens and reduced motion get a normal-flow scene with selectable steps. So do
  no JavaScript and a failed script.
- Everything moves by transform and opacity on layers rasterised once. No filters, blur
  or backdrop-filter. Writes go through one function that skips identical values.
- `.ground` never moves but has its own layer anyway. See "Performance".
- The frame loop runs only for a scroll, a chapter tween or the plates' float. Paused, or at
  rest on a beat, it stops.
- Plate and token walls carry the mark's studio as SVG gradients: pale softboxes broken by
  dark bands, a fifth softer on the shared plane. The printed mark stays black.
- A layout change keeps the reader's place: in the section they stay on their beat, past
  it they stay the same distance below it, and above it nothing moves.

## Questions

Three typographic rows with fine rules, using native `details`. The first starts open.

## Closing poster

`src/components/Poster.astro`. One composition: invitation, working form, art and the
oversized wordmark. The headline, form, wordmark and links are real HTML. The art
(`src/assets/poster-art.png`, baked from the original `shared-field-footer.png` by
`tools/render-poster-art.mjs`) is positioned from the wordmark in container units, so the
seam keeps its relationship to the letters at every width. Never stretch the art
independently in x and y. Contrast comes from plain gradient washes, not blur.

Only real links appear. `Privacy` and `Contact` show up when their values are set in
`src/config/site.ts`.

## Explore

Removed with the header. The last version is in git at `4cdfebd`
(`src/components/Header.astro`, `src/scripts/explore.ts`).

## Forms

`src/components/WaitlistForm.astro`, `src/scripts/waitlist.ts`. An open underline with a
persistent label, and a round submit control with an explicit accessible name. Success
appears only after a 2xx response with an accepted status. With JavaScript, entered values
survive every failure. The field is read-only while its request runs, so an answer always
describes the address that was sent. A failure shows on every form holding that address,
and if none of them is in view the page goes back to the form, unless the visitor is
typing somewhere else. A success never moves the page or takes the cursor from someone
typing. Motion state and submission state stay separate, and motion only ever observes the
`waitlist:state` event.

## Motion ownership

One owner per moving property.

| Property | Owner |
|---|---|
| Mark pose, bonds, light, resolution | `hero-scene.ts` frame loop |
| Stage role, tab stop, hint, caption | `hero.ts` |
| Everything in the process scene | `process.ts`, from `sceneAt(p)` |
| Hover, form states | CSS |
| Whether motion may run | `src/scripts/motion.ts` (`reduced`, `paused`, `ambient`) |
| Page setup and teardown | `onPage` in `src/scripts/page.ts` |
| Eased page scrolling | `src/scripts/smooth-scroll.ts` (GSAP ScrollSmoother) |

Anime.js is gone. No Motion or React. Three.js exists only in the lazy hero chunk.
GSAP is used only for ScrollSmoother page scrolling (`src/scripts/smooth-scroll.ts`); it is
off under reduced motion and on touch. In-page links and `scrollIntoView` go through its
`scrollToElement` helper, since the content sits in a fixed wrapper.

The pause control shows while a surface with `data-motion-live` is on screen, and never
under reduced motion. A hero left on its poster sets no such flag, so it offers nothing to
pause. It leaves as the questions or the poster reach its corner, because their own
controls would slide under it, and it stays up while it holds keyboard focus. Its place in
the markup follows the hero, for tab order only. Paused, direct actions jump to their
result, including long scrolls.

## Performance

Measured on this build in real Safari 27 on Apple GPU at 1512×859 @2x, with the probe page
scrolling the whole document in 10 seconds. That is a synthetic scroll, not a trackpad, and
one Mac is not a fleet. Safari's GPU process was already busy and could not be cleared, so
these are not clean-room numbers. This page: three runs of three passes each, 5,519 frames.
Old page: one stored run, one pass down and one up.

| Measure | Old page | This page |
|---|---|---|
| Scroll p95 | 24-26ms | 19-21ms |
| Frames over 20ms, per pass | 43-47 | 7-35 |
| Frames over 34ms, all passes | not stored | 8 |
| Frames over 50ms, per pass | 0 | 0 |
| Worst frame | 35ms | 48ms |

Most of the frames over 34ms are on the first pass down, as layers rasterise for the first
time. The page is steadier than the old one, but its single worst frame is longer.

Three things found by measuring, not by reasoning. Keep all of them:

1. **`.ground` has its own layer.** Painted with the pinned content, Safari redrew its
   gradient strokes on every scrolled frame, which held the whole page at about 45fps.
   Hiding every moving layer changed nothing. Hiding this one static SVG fixed it.
2. **`.poster-art` has its own layer.** Otherwise Safari redrew the art in pieces as it
   entered view, a 60-90ms stall on every pass.
3. **The art's fade is in the image.** As a CSS gradient on that layer, it cost a 40-75ms
   frame at the same scroll position on every pass, just as the poster entered view. A
   plain gradient in place of the art stalled the same way and the image format made no
   difference, so it was never the image. Without the gradient: 1 stall in six passes,
   against 10. Baked, the picture is within 0.4 levels of 255 on average at eight sizes.

Script cost is not the limit: the frame loops averaged about 0.15ms.

Also seen in real Safari: a true back/forward cache restore keeps one live canvas at 60fps,
a 3D chunk delayed 6 seconds still hands over cleanly, and a failed chunk or a WebGL context
lost at creation leaves the poster with no false promise of interaction.

## Payload

| Asset | Size | Gzipped | Loaded |
|---|---|---|---|
| HTML | 71 KB | 14 KB | Always |
| CSS | 40 KB | 8 KB | Always |
| Page script | 24 KB | 9 KB | Always |
| Hero chunk (three.js) | 490 KB | 122 KB | After first paint, WebGL only |
| Exposure | 718 KB | Already compressed | Always, and far too large |
| Instrument Sans | 35 KB | Already compressed | Always |
| Poster art, largest AVIF | 223 KB | Already compressed | As the poster nears the screen |

A licensed, subset Exposure would be a fraction of that size. It is the single largest
improvement left.

## Sources

Art direction and research live in the private study pack (`DESIGN.md`, `MOTION-SPEC.md`,
`REFERENCE-RESEARCH.md`). References informed the work and none of their assets or code
ship here, apart from Exposure, covered above. Provenance is in
`docs/ASSET-PROVENANCE.md`.
