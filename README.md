# Covalent waitlist page

The current private landing page has a minimal header, “Your agents. In sync.”
hero with an interactive 3D mark and email form, and a closing “Good work has
chemistry.” poster with a second form and the `covalent.` wordmark. The section
backgrounds blend together. The middle demo, FAQ and Explore menu are parked;
their source remains available for a future product site.

Built with Astro 7, Three.js and one on-demand route, `POST /api/waitlist`.
There is no Anime.js, GSAP, Motion or React. No real signup provider is connected.

[`DESIGN.md`](DESIGN.md) records the current scope above the earlier design notes.
[`docs/launch-kit/`](docs/launch-kit/) is retained as superseded research history.

## Run it

Node 22.12+ (Node 24 recommended).

```sh
npm install
WAITLIST_PROVIDER=test npm run dev     # http://localhost:4321, with the controlled test destination
npm run check                          # astro check (TypeScript + templates)
npm test                               # unit tests (vitest)
npm run build && npm run preview       # production build, served by the Node adapter on :4321
```

Without `WAITLIST_PROVIDER`, signups answer `503 unavailable` and the page shows its
retry message. That is deliberate: no provider has been chosen yet, and the page
never reports success it did not receive.

### Testing the form states

With `WAITLIST_PROVIDER=test` (dev only, or a preview with
`WAITLIST_ALLOW_TEST_PROVIDER=1`), the email's local part chooses the outcome:

| Email | Result on the page |
|---|---|
| `anything@example.com` | "You’re on the list…" (a repeat is treated as a duplicate and looks the same) |
| `confirm@example.com` | "Check your inbox to confirm your place." |
| `duplicate@example.com` | same as a new signup |
| `slow@example.com` | "Joining…" for 2.5 s, then accepted |
| `limit@example.com` | rate-limited message, email kept |
| `fail@example.com` | "We couldn’t add you yet. Please try again.", email kept |
| `reject@example.com` | inline field error |

The local rate limiter allows 20 attempts per client address per 10 minutes by default; set
`WAITLIST_RATE_LIMIT=500` while clicking through states.

## Where things are

```text
DESIGN.md                   current scope and earlier design notes
src/config/site.ts          copy, messages, questions, process words, release inputs
src/lib/mark.ts             mark geometry (a measured study, see "Before anything public")
src/lib/mark-solid.ts       the mark as a 3D solid, from that geometry
src/lib/spring.ts           damped springs for the hero
src/lib/process-scene.ts    the process scene's geometry, from one projector
src/lib/process-timeline.ts sceneAt(p): the whole scene as a pure function of progress
src/lib/waitlist/           server boundary: validation, rate limit, providers, handler + tests
src/pages/api/waitlist.ts   the on-demand route
src/pages/waitlist/*.astro  result pages for signups sent without JavaScript
src/components/             Header, Hero, Process, Questions, Poster, WaitlistForm, MotionToggle
src/scripts/waitlist.ts     form behaviour
src/scripts/hero.ts         hero stage, input, lifecycle (imports no three)
src/scripts/hero-scene.ts   the Three.js scene, a separate lazy chunk
src/scripts/process.ts      parked demo animation (not imported by the landing page)
src/scripts/explore.ts      header behaviour and the optional, currently hidden Explore panel
src/scripts/motion.ts       reduced motion, the pause control's state
src/scripts/density.ts      reports a move to a display with a different pixel ratio
src/scripts/page.ts         onPage: setup and teardown across navigation
tools/render-mark-poster.mjs regenerates src/assets/mark-poster.png
tools/render-poster-art.mjs bakes src/assets/poster-art.png from the original art
public/fonts/               the fonts (status in docs/ASSET-PROVENANCE.md)
docs/WAITLIST-PROVIDER.md   the signup contract and how to add a real provider
docs/ASSET-PROVENANCE.md    where each asset came from, including the fonts
```

## Behaviour worth knowing

- **Forms.** Labelled field, `type=email`, permissive validation (browser check +
  server check). One request at a time, and the field is read-only while it runs. Success
  appears only after a 2xx response with an accepted status. A success in one form updates
  the other form when it holds the same address, and a failure does too. A failure nobody
  can see brings the page back to the form; a success never moves the page. The email is
  never stored, logged, or put in a URL. Without JavaScript the form posts natively and
  the server redirects to a result page.
- **Header "Join the waitlist".** Focuses the hero form if it is on screen, and otherwise
  takes you to the closing form. Visitors never have to finish the story to sign up.
- **Hero.** Readable copy and a real rendered poster arrive in the HTML. The 3D scene takes
  over only once it has drawn, and if WebGL is missing or lost the poster simply stays.
  Hover, drag, click and keyboard control the mark. Typing advances the inner bonds,
  deleting reverses them, and an accepted signup triggers the completion animation.
- **Parked sections.** `Process.astro` and `Questions.astro` remain in the source but
  are not rendered by `index.astro`. Restore their imports, markup and the process
  script together when bringing the demo back.
- **Pause.** A fixed control stops ambient motion while something can move on screen, and
  steps aside when ambient motion is off screen. Paused, direct actions jump to
  their result, long scrolls included. Reduced motion removes it, because there is nothing
  to pause.

## Before anything public

These block a public release. None has been decided here.

1. **Exposure licence.** The display font is an unlicensed private-study file, and its own
   metadata says web use needs a licence from 205TF. It must not be deployed publicly as it
   stands. Buy the web licence or swap `--font-display`. See `docs/ASSET-PROVENANCE.md`.

2. **Signup destination.** Choose the provider, add an adapter in
   `src/lib/waitlist/providers/`, set its secrets server-side, decide single vs double
   opt-in, then verify a real address end to end. See `docs/WAITLIST-PROVIDER.md`.
3. **Privacy notice and contact.** Set `site.privacyUrl` and `site.contactEmail` in
   `src/config/site.ts`; the links appear under the forms and in the footer only when
   set.
4. **Approved logo vector.** `src/lib/mark.ts` is a reconstruction measured from the
   supplied flat mark (regular hexagon, measured stroke and bond proportions). Replace it
   with the master, then regenerate the poster.
5. **Canonical URL and social image.** Set `site.url`; no Open Graph image exists yet.
6. **Hosting adapter.** `@astrojs/node` is the default; swap it for the host's adapter
   in `astro.config.mjs`. The rate limiter is per process; rely on provider/platform
   limits too. The Node adapter compresses nothing and serves `/fonts/` with `max-age=0`,
   so the host or a proxy must compress text and long-cache `/fonts/`.
7. **Claims review** of product copy (agent support, early-access terms) before launch.

## Licenses

three.js (MIT) ships in the hero chunk. Instrument Sans (SIL OFL 1.1) ships in
`public/fonts/` with its licence. Both are listed in `public/third-party-licenses.txt`,
which is retained even though its footer link is hidden. Exposure is listed there too, as a private-study file that needs a
licence before public use.
