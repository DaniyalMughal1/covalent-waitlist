> **Superseded.** Kept for history. The current contract is `DESIGN.md` in the app root.
> Its limits on motion, 3D, the demo, the footer and fonts no longer apply.

# Brand motion and product demonstration

## What exists in Harness MVP

Reference files copied from `src/cli/ui/brand/`: `logo.ts`, `ring.ts`, `color.ts`. Local HEAD at inspection: `162d105a2711927bde6e6fbbdad7053be6af19c9`. These are source excerpts for reference, not a drop-in browser component.

| Source behavior | Observed implementation | Website adaptation |
|---|---|---|
| Mark | Flat-top/bottom hexagon; three alternating inner bonds | Preserve shape, spacing and fixed outer ring |
| Intro | Outline 0–0.9s; bonds 0.7–1.15s; greeting types; pixel wordmark wipes | Draw mark once, keep marketing copy visible throughout |
| Keystroke / planning | Inner bonds hop 60°; planning auto-hop every 0.45s | One 60° hop when a context item is received |
| Working | Bonds form circle over 0.7s; terminal spin 600°/s | Slow, short progress motion only in a user-started demo |
| Exit work | Settles back over about 0.9s | Deliberate transition to handoff state |
| Question / error / done | Inner geometry becomes ?, ! or ✓ | Use same semantic mapping plus readable status text |
| Terminal status | Purple/yellow/red/green; some blink/breathe behavior | Darker web colors; eliminate error/done flashing |

The source uses a braille canvas: 2×4 dots per terminal cell. Do not treat a stretched terminal screenshot as the vector shape. A regular flat-sided hexagon has a geometric width/height ratio of `2 / √3`; stroke extents and padding affect the final bounding box. Use one uniform SVG scale with `preserveAspectRatio="xMidYMid meet"`. The supplied brand artwork remains the visual authority for exact stroke weight and corner shape.

## Proposed hero sequence, under five seconds

- 0–900ms: outer mark draws with cubic easing. The full page text and form are already visible.
- 700–1150ms: three inner bonds appear.
- 1300–1800ms: one context label appears beside the diagram; inner bonds advance 60°.
- 2000–2600ms: a pair of small points travels along one connection, then disappears into the shared context node.
- By 3200ms: settle to the static mark; no automatic repeat.

This is a proposed choreography, not a measured Twain timeline. Reduced motion: render the completed static composition immediately. The included concept demonstrates a simplified 3.2-second bond rotation and settle; it does not implement the complete point-based terminal morph.

## Demo: “Add a team invite flow”

Use one shared project, two teammate-owned agents, and a review checkpoint. Sample filenames are illustrative. The demo's appearance is proposed; its underlying operations are informed by the repo.

| Stage | Screen content | What the viewer learns |
|---|---|---|
| 1 · Shared context | Shared brief: “Add team invites”; agreed fact: “Invite links expire after 24 hours”; UI agent and API agent both show “Context received” | Task-relevant project information can reach both agents |
| 2 · File claims | UI agent claims `InviteForm.tsx`; API agent claims `invites.ts`; clear owner badges | Agents coordinate who works where |
| 3 · Handoff | API agent shares “Invite endpoint ready”; UI agent shows “Handoff received”; brief remains visible | One agent can continue from the other's project information |
| 4 · Review | Two changes marked “Ready for review”; human review checkpoint shown | People retain the review decision |

No anonymous swarm, fake percentages, invented speed metrics, code rain, auto-merge or production deploy. Do not imply all of an agent's private conversation/history is copied to other agents. Shared context means the project messages/facts/tasks explicitly shared through the system.

Layout: compact title bar and concept label; two agent lanes with a shared-context hub between them; one concise explanation below. On mobile use stacked lanes and a slim connector. Minimum demo body text 14px desktop and 14px mobile; make details reflow instead of shrinking a desktop screenshot.

Controls: four ordinary stage buttons with `aria-pressed`, a single Play/Pause button, and Replay after completion. Default is the static first stage. Play runs the stages once, about three seconds each. Selecting a stage pauses playback. Keep a static explanatory sentence available; avoid announcing every animation frame. Pause automatically if the demo leaves view or the document is hidden. No sound.

## Technical ownership

Use CSS for hover/focus/press and Anime.js v4 for coordinated SVG sequences in a React build. The local concept uses native browser animation so it opens without a package install. This is a deliberate demo implementation difference, not a recommendation to mix multiple motion systems in production.

In Anime v4 use named imports such as `createTimeline` and `createScope`; clean up the scope on unmount. Keep DOM ownership local to the component, stop timers/observers on teardown and avoid hydration-dependent hidden content. Animate transforms/opacity where practical; avoid large animated blur/shadow fields. [React integration](https://animejs.com/documentation/getting-started/using-with-react/), [timeline API](https://animejs.com/documentation/timeline/).

Use SVG for the mark and connectors. A WebGL renderer is unnecessary for the launch's geometry. If a final metal render is desired, create one approved lightweight asset with a static fallback and keep the functional mark vector-based. Never stretch the supplied PNG or crop out a logo as a substitute for the master vector.
