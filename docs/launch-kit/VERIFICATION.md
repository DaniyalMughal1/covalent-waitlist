> **Superseded.** Kept for history. The current contract is `DESIGN.md` in the app root.
> Its limits on motion, 3D, the demo, the footer and fonts no longer apply.

# Verification and remaining release inputs

## Checked in the included design study

- Chromium rendered the concept at 1440×1000, 1366×768, 768×1024, 390×844 and 320×720 without horizontal document overflow.
- At 1366×768 the hero form row ends around y=640, within the initial viewport. At 390×844 it ends around y=594; hero artwork starts around y=723, after the form.
- Inspected desktop hero, mobile hero, and product-scene screenshots. Fonts loaded successfully. Images used in the visual guide exist locally.
- Selecting Claims updates file names, ownership labels and the pressed control. Timed playback progressed to Ready for review and changed the control to Replay.
- Browser reduced-motion emulation reported the preference active and zero running document animations after reload.
- Empty email fails native validity. A local `preview@example.com` submission reports that nothing was sent or saved. Local/session storage remained empty.
- No console errors were reported after clearing the browser log and reloading the local concept for those checks.
- Reference guide contains ten panels; filtering Footers shows three. Local HTML references and Markdown file links were checked for missing files.

These checks cover the local concept. They do not establish production accessibility conformance, field performance, conversion rate, or cross-browser parity. The actual landing page has not been deployed.

## Still required for the final build

1. Approved vector logo/wordmark master. The prototype's vector is a source-informed study.
2. Signup provider and actual persistence path, privacy wording and verified contact destinations.
3. Final product claims review, particularly supported agent providers and early-access terms.
4. Production-browser checks including Safari, mobile keyboard and assistive technology; server-side form cases and delivery/confirmation behavior.
5. Production font optimization and real performance measurements. Full TTFs are included for a portable offline concept.

The annotated reference board and research are complete enough for Claude to begin implementation. None of these remaining inputs should be replaced by invented data or placeholder links on the published page.

## File provenance

- `references/screenshots/*-user.png`: original images supplied by the user, unchanged.
- Other reference screenshots: captured during live browser/Safari research. Their pixels represent one moment of a dynamic page.
- `references/brand/`: original Covalent images and terminal still supplied by the user.
- `references/brand/source/`: selected Harness MVP source files copied for research, not executed or modified.
- `references/observations/`: browser-derived measurements from the live references.
- `references/resources/`: selected MIT Fancy source, upstream license notices, repository revision pins, and a download manifest.
- `assets/fonts/`: OFL font files and notices. Original URLs and Git blob hashes in the download manifest.
- `concept-*.png` and `guide-*.png`: captures of this kit's own review artifacts.

Reference imagery is not part of the proposed production site's asset set. Keep `references/` and this research guide out of the deployed website bundle.
