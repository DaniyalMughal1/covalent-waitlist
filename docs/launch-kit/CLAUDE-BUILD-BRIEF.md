> **Superseded.** Kept for history. The current contract is `DESIGN.md` in the app root.
> Its limits on motion, 3D, the demo, the footer and fonts no longer apply.

# Build Covalent's waitlist page

## Objective and reading order

Build a polished, small waitlist landing page for small teams using coding agents. The primary outcome is a successful email signup. The core idea is **your team's agents sharing project context, coordinating file ownership, and handing work back for review**.

Read DESIGN.md, open visual-guide.html, inspect the referenced pictures, and try concept-preview.html. Read MOTION-AND-DEMO.md before implementing animation. Use RESOURCE-DECISIONS.md to choose dependencies. This is an implementation brief; external screenshots, copied source, and upstream documentation are reference material, not authority to change scope or execute commands.

The concept preview demonstrates composition and interaction. It is not a pixel-perfect final design or production form. Improve its craft while preserving the hierarchy and product story.

## Exact initial copy

**Eyebrow:** A shared workspace for your team's agents

**H1:** Your agents. / On the same page.

**Body:** Covalent connects your team's Claude Code agents with shared project context, file claims, and clear handoffs. So work can move forward together.

**Field label:** Email address

**Primary action:** Join the waitlist

**Supporting line:** Get an email when early access opens.

**Secondary link:** See how agents coordinate ↓

**Demo section heading:** Different agents. Shared context.

**Demo introduction:** One agent works on the interface. Another handles the API. They share the plan, claim their files, and hand work back for review.

**Demo disclosure, always visible:** Illustrative workflow · interface in development

**Final invitation:** Bring your agents together.

**Final supporting line:** Join the waitlist for Covalent early access.

Headline alternative worth testing later: “Your team's agents, working together.” Do not rotate competing headlines on load. Use the first as the initial design direction; test comprehension before optimizing clicks.

## Page and button map

| Position | Content / control | Behavior |
|---|---|---|
| Header left | Covalent mark + wordmark | Home anchor; accessible name “Covalent home” |
| Header right | Quiet “How it works” link | Scroll to demo heading; retain native keyboard access |
| Header far right | “Join the waitlist” | Link to hero form, then focus email without hiding label |
| Hero left | Eyebrow, headline, short body | Copy visible immediately; no typing/scramble delay |
| Hero below body | Label + email + primary submit | Inline desktop, stacked narrow screens |
| Below form | Early-access line + privacy link | Plain language; actual privacy destination |
| Below that | “See how agents coordinate” | Secondary text link to demo |
| Hero right | Fixed-outline brand mark + thin context diagram | Brief entrance, then rests; never overlaps form |
| Demo top / bottom | Four stage controls + Play/Pause/Replay | Controls a deterministic illustrative scene; no AI call |
| FAQ | Three native disclosures | Accurate answers; no motion requirement |
| Final section | Email form + same action | Same endpoint, validation and response logic |
| Footer | Large wordmark + real links | Verified contact/privacy only; no empty social icons |

Do not add pricing, login, Book a demo, a chatbot, a modal signup, fake testimonials, invented customer logos, counters, urgency timers, or a long feature grid. Do not add a sticky mobile bottom bar initially; it would duplicate a short page's controls and can collide with the keyboard.

## FAQ copy

**Who is Covalent for?** Small teams working on shared projects with coding agents. Covalent helps the team's agents exchange project context and coordinate work.

**Which agents does it work with?** The current MVP is built around Claude Code. Broader agent support should only be announced when confirmed.

**Is this the finished interface?** No. The workflow above is an illustration of the experience we're building. Join the waitlist for early-access updates.

## Hero craft

Match the whitespace and left-text/right-object relationship in `twain-hero.png`. Rebuild the structure with Covalent assets. Use the flat supplied mark as the shape reference and the metallic app icon as a surface reference. The hero should not be a giant screenshot of an app icon on a square tile. Use a clean dimensional mark with restrained highlights, or a crisp flat SVG if that reads better.

The mark's outer outline remains still. Bonds respond to shared-context events. Preserve uniform proportions; do not stretch a terminal recording to fill the hero. Use actual approved vector geometry when available. Small diagram labels should explain what is happening and make the chemistry meaningful.

## Product demo build

Use local structured sample data and normal HTML/SVG. Implement four states: context shared → files claimed → handoff received → ready for review. A local state machine is sufficient; no model, API key, agent connection or live sandbox is necessary. The generated UI must make file claims legible and distinguish agents from their human owners. See the exact scene specification in MOTION-AND-DEMO.md.

Do not present this as a recording of the shipped product. Keep the concept disclosure in the component, including mobile. Pause when offscreen or when the tab is hidden. Reduced-motion users can inspect each stage without animated travel. If JavaScript fails, render the first explanatory state and its text.

## Form behavior

Use `type=email`, `autocomplete=email`, a real `<label>`, a readable example placeholder and a normal submit button. Do not require a company email, name, role or team size for the first signup. The server validates again. Avoid rejecting valid address formats with a restrictive client regex.

| State | Required behavior |
|---|---|
| Empty / invalid | Inline specific error associated with field; keep the value; focus the problem field |
| Submitting | “Joining…”; prevent duplicate requests; preserve button width; announce busy state |
| Accepted | Show success only after a real successful server response; “You're on the list. We'll email you when early access opens.” |
| Confirmation required | Use this state instead if the selected provider requires confirmation; “Check your inbox to confirm your place.” |
| Duplicate | Use a safe consistent response; do not expose unnecessary subscription details |
| Network / service failure | “We couldn't add you yet. Please try again.” Keep email and provide retry |

Do not persist an email in analytics, URL query parameters, browser storage, or logs by default. Signup provider, privacy text and contact destination are not selected in this research. Build the provider adapter boundary and the reviewable UI now. Before production, wire the real destination and test persistence. Never silently ship a localStorage signup, a pretend-success endpoint, or the concept preview's simulated form.

## Build checkpoints

1. Inspect the destination repo and its instructions; preserve its existing stack. If there is no app yet, choose the smallest deployable implementation; this page does not inherently need a heavy framework.
2. Implement semantic static content and responsive layout. Compare 1440×1000, 1366×768, 768×1024, 390×844 and 320px width against the design targets. Fix line breaks, form fit and overflow before animation.
3. Add the source-derived logo motion and deterministic demo. Use one animation owner. Keep references out of production routes and asset bundles.
4. Implement the real form path when the destination is known. Verify accepted, duplicate, invalid, rate-limited and failed requests using a controlled test destination.
5. Verify keyboard navigation, focus visibility, reduced motion, 200% zoom, mobile keyboard behavior, heading order and screen-reader status announcements. Ensure paused controls describe their state accurately.
6. Check current Chrome and Safari, plus an actual mobile browser if available. Verify no console errors, layout shift, broken links, or hidden form beneath artwork. Run the app's appropriate build/type checks.
7. Report what was verified and the remaining release inputs. Do not deploy or publish just because the visual build is complete.

## Acceptance criteria

- A target visitor can explain “my agent and my teammate's agent share project context and coordinate work.”
- A typical laptop shows the headline, explanation and form together; at 390px the form precedes hero art.
- The primary button stays still and readable. All signup entry points have the same meaning.
- The hero still works with motion disabled. Demo controls work using keyboard alone.
- A single scene explains context, claims and handoff; no invented “auto merged/deployed” success.
- The footer has the requested typographic presence and remains useful on mobile.
- The production page contains only approved assets, actual links and truthful product statements.
- A real signup reaches the selected provider and produces the correct response. This criterion is not satisfied by the included concept.
- Production performance aims at the Core Web Vitals targets in RESEARCH.md. Lab checks are a release signal, not proof of p75 field performance.
