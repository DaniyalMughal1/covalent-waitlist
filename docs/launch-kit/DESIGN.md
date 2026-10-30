> **Superseded.** Kept for history. The current contract is `DESIGN.md` in the app root.
> Its limits on motion, 3D, the demo, the footer and fonts no longer apply.

# Covalent design system · launch direction

Status: proposed visual system, grounded in the supplied brand and inspected references. It establishes a reusable foundation for the future site.

## Character

White, composed, precise, tactile. An editorial headline introduces a technical product. The benzene-inspired mark supplies the personality. Chemistry appears through bonds, shared structure, and restrained diagram notation. The page should feel like a well-made instrument with a human voice.

Use a single large hero object and one product scene. The signup form carries the strongest functional contrast. Avoid generic glowing neural clouds, background particle fields, a globe, decorative equations, laboratory glassware, fake element abbreviations, and a periodic-table feature grid.

## Typography

| Role | Face | Desktop | Mobile |
|---|---|---|---|
| Display headline | Source Serif 4, 500, optical size ~60 | 80px / 0.99, -0.045em | 46px / 1.04, -0.04em |
| Section title | Source Serif 4, 500 | 48px / 1.05 | 34px / 1.1 |
| Body | Instrument Sans, 400 | 18px / 1.55 | 17px / 1.5 |
| Button / label | Instrument Sans, 600 / 500 | 15px / 1.2 | 15px / 1.2 |
| Diagram annotation | system monospace; optional existing licensed project mono | 11–12px / 1.4 | 11–12px / 1.4 |

Self-host the included OFL fonts. Convert/subset to WOFF2 for production, retaining notices and testing actual text coverage. The concept uses full TTFs for portability, so its transfer size is not a production budget result. Limit primary above-fold font requests; a third font is optional, not required. Source Serif is a proposed accessible-to-obtain alternative, not Twain's Produkt.

Use the original wordmark asset when available. The concept's text lockup is provisional. Preserve the repo's pixel wordmark for a small terminal provenance detail or motion specimen, rather than applying pixel type to all marketing copy.

## Color tokens

```css
--paper: #ffffff;
--surface: #f6f7f6;
--ink: #18201e;
--muted: #5c6561;
--line: #dce1dd;
--focus: #275dd8;
--plan: #76529d;
--question: #806100;
--error: #b42336;
--done: #26734a;
```

Graphite primary button, white label. Silver is a material accent, not a gradient behind every block. Status colors are darker website adaptations of terminal colors; always pair them with a word or symbol. Confirm contrast in actual combinations. Decorative large footer text may be pale; links and informative text must remain readable.

## Geometry and layout

- Base spacing: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Content max width: 1280px. At 1440px: 80px side gutters. At 1024px: 40px; at 768px: 32px; at 390px: 20px. Do not use fixed heights that clip translated or zoomed text.
- Nav: approximately 80px high; brand left, quiet demo link and waitlist button right. Non-sticky at launch; page is short enough without covering content.
- Desktop hero: two columns 1.05fr / .95fr, 64px gap; approximately 560–680px total content height. Headline and form visible together on a typical laptop. Test at 1366×768, not only tall design canvases.
- Small screens: text, form, trust note, secondary link, then hero artwork. No artwork above the value proposition. Collapse to one column below ~900px; make the form stack when it no longer fits naturally.
- Section spacing: 96px desktop / 64px mobile. Demo: one rounded framed surface; explanation adjacent or below, not six separate bento cards.
- Button radius 12px; input 12px; demo frame 24px; hero stage 32px if framed. Thin 1px borders. Subtle shadow only on raised controls or the main object.
- Button height: nav 48px; form 52px. Input height 52px; text ≥16px. Field grows; action stays readable. Mobile field and action both fill the column.

## Chemistry grammar

1. Keep the outer hexagon stable. Inner bonds move in 60° increments, then form the working ring. This already exists in Covalent's brand source.
2. Use a double line sparingly to represent shared context between agents. Treat it as a metaphor, not a molecular simulation or a scientific claim.
3. Use small diagram labels for real information: “shared context”, “file claimed”, “ready for review”. No random formulae or pretend atomic numbers.
4. A pair of tiny moving points may travel along a connection once when context is handed over; stop on arrival. They must not resemble active live agents when the demo is paused.
5. Keep at most one diagram layer behind the hero mark, at very low contrast. It must not cross text or form fields.

## Footer

First, a final simple invitation and the second email form. Then a thin divider, a small brand sentence, verified contact/privacy links, and an oversized lowercase `covalent` wordmark. Its text should fit rather than be unintentionally cut off.

Recommended launch version: solid or subtly outlined wordmark in light graphite. Optional enhanced version: tiny words “context · claim · coordinate · review” follow custom Covalent letter paths, inspired by Twain and Fancy's text-path technique. Build actual letter paths; a text stroke is not a text-path construction. Keep an accessible plain brand name and mark the decorative art aria-hidden. Desktop may reveal the footer normally; use normal document flow on mobile. No endless footer marquee.

## Interaction standards

Hover: 140–180ms, modest background change; press: 1px down, no magnetic target. Focus: clearly visible 2px outline plus offset. Header/final CTA links focus the hero email field only when they are navigation links; actual form submit stays local to that form. Keep entered email during failure and synchronize optional repeated-form values carefully without duplicate submissions.

Use native links/buttons/labels. Native scrolling. Keyboard access. Respect reduced motion. Do not animate the headline through illegible intermediate text. Page content is visible if motion fails or JavaScript is delayed.
