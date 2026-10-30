# Asset provenance

Where the page's non-code assets came from. These notes stay in the project and never
appear in the signup flow.

| Asset | Source | Status |
|---|---|---|
| `src/assets/shared-field-footer.png` | Original raster plate generated for Covalent with the built-in image generation tool on 30 October 2026, kept unchanged from the art-direction pack. | Ours to use. Keep this original. |
| `src/assets/poster-art.png` | The original with its two edge fades baked in by `tools/render-poster-art.mjs`. | Generated. This is the file the page uses, and its sizes are generated at build time. Re-run after any change to the art, `--paper` or the poster's `--ground`. |
| `src/assets/mark-poster.png` | Rendered from this app's own hero scene by `tools/render-mark-poster.mjs`. | Generated. Re-run after any change to geometry, pose or lighting. |
| `public/fonts/Exposure-VAR.woff2` | Polarity's publicly served file, by way of the private study pack. Unmodified. | **Not licensed for public use.** See "Exposure: release blocker" below. |
| `public/fonts/instrument-sans-latin-var.woff2` | Subset from the `google/fonts` repository. | SIL OFL 1.1, licence shipped alongside. |
| `src/lib/mark.ts` | A measured reconstruction of the supplied flat mark. | Replace with the approved master vector when it exists. |

The footer art's brief, for reference: two smoked-glass ribbons with liquid-silver edges
sweeping from opposite lower corners toward one luminous meeting point, warm-white space
above for the invitation and dark material below for the wordmark, with no text, logo or
interface. All type, forms and the mark are added in code.

Reference screenshots and third-party bundles were studied in the private pack and none of
them ship in this app.

## Fonts

`@font-face` rules live in `src/styles/fonts.css`. The files live in `public/fonts/`.

| File | Family | Role | Size | Licence status |
|---|---|---|---|---|
| `Exposure-VAR.woff2` | Exposure (205TF) | Display | 718 KB | **Not cleared for public use.** See below. |
| `instrument-sans-latin-var.woff2` | Instrument Sans | Body and controls | 35 KB | SIL OFL 1.1 |
| `OFL-InstrumentSans.txt` | Licence for Instrument Sans | | | Must ship with the font |

### Exposure: release blocker

`Exposure-VAR.woff2` is the unmodified file from the private art-direction study, which
took it from Polarity's publicly served copy. It is here because the owner chose to
evaluate the real typeface in a private exploration. Nothing in this project licenses it.

The font's own name table (ID 13) says copying and sharing are not allowed, and that web
use needs a specific licence from 205TF (http://www.205.tf). Before this page is
deployed anywhere public, do one of the following:

1. Buy the Exposure web licence from 205TF and replace this file with the licensed
   build, subset to the characters the page needs. Refit the `Exposure Fallback` metric
   overrides if the file's metrics differ.
2. Choose another display face. It is one token: `--font-display` in
   `src/styles/global.css`. Also remove the `"EXPO"` `font-variation-settings` uses,
   which only exist on this font (`grep -r EXPO src`).

The file is deliberately not subset or converted, because the licence text forbids it.
That makes it by far the largest asset on the page. A licensed subset would be a fraction
of the size. See "Payload" in `DESIGN.md`.

### Instrument Sans

A subset variable WOFF2 built from the `google/fonts` repository
(`InstrumentSans[wdth,wght].ttf`, Version 1.000, git blob
`3589b81b22d3defc725dfdcdf16b5da7c9adc691`) with fontTools 4.68.0: `wdth` pinned to 100,
`wght` kept at 400–700, then `pyftsubset` with
`--unicodes=U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193,U+21BA,U+2713,U+00B7`,
`--layout-features+=kern,liga,calt,case,tnum,lnum,ss01,ss02,ss03,ss04,ss05`, `--no-hinting`
and `--name-IDs=*`. 307 glyphs, 198 mapped code points.

`OFL-InstrumentSans.txt` is a byte-identical copy of the upstream `OFL.txt`. OFL 1.1
requires it to travel with every copy of the font.

The font lacks ✓ (U+2713) and ↺ (U+21BA). Use inline SVG for those.
