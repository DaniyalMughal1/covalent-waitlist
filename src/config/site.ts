// Site-wide copy and release inputs.
//
// Release inputs that have not been supplied stay `undefined`; components render a link
// only when its destination is set, so the page never ships a placeholder link.

export const site = {
  name: "Covalent",
  title: "Covalent · Your agents. In sync.",
  description:
    "Covalent gives your team’s coding agents shared context, clear file ownership and handoffs, so work on the same project stays in sync. Join the waitlist for early access.",
  // Canonical origin, e.g. "https://covalent.dev". Release input.
  url: undefined as string | undefined,
  // Privacy notice for the waitlist. Release input: must be the real, approved page.
  privacyUrl: undefined as string | undefined,
  // Verified contact address, e.g. "hello@…". Release input.
  contactEmail: undefined as string | undefined,
};

export const copy = {
  eyebrow: "For teams building with agents",
  headline: ["Your agents.", "In sync."],
  body: ["Shared context. Clear ownership.", "A better way for your team’s agents", "to work on the same project."],
  heroFieldLabel: "Email for early access",
  finalFieldLabel: "Email for the waitlist",
  placeholder: "you@company.com",
  action: "Join the waitlist",
  busy: "Joining…",
  support: "We’ll email you when early access opens.",
  secondary: "See the connection",
  processKicker: "How it works",
  conceptNote: "Concept preview",
  faqHeading: ["A little", "more context."],
  finalKicker: "Good work has chemistry.",
  finalHeading: ["Good work", "has chemistry."],
  footerLine: "A shared workspace for your team’s agents.",
} as const;

export const processSteps = [
  {
    name: "Context",
    title: "A shared starting point.",
    body: "One project brief becomes common ground. Both agents work from the same decisions.",
    activity: "Shared decision: invite links expire after 24 hours.",
  },
  {
    name: "Claims",
    title: "Room to work together.",
    body: "Each agent claims its files. Ownership stays visible while the work moves forward.",
    activity: "UI agent claims InviteForm.tsx. API agent claims invites.ts.",
  },
  {
    name: "Handoff",
    title: "The handoff. In context.",
    body: "The API agent passes its endpoint details to the UI agent. The project keeps its context.",
    activity: "Handoff: POST /invites is ready for the UI agent.",
  },
  {
    name: "Review",
    title: "Back to your team.",
    body: "Both changes return for review. Your team decides what ships.",
    activity: "Two changes are waiting for a person to review.",
  },
] as const;

// Words that sit on objects in the process scene, plus its plain description.
export const processScene = {
  description:
    "Two agent plates above one shared project plane. They read the same brief, “Add a team invite flow”, separate to claim their own files, pass a handoff across the plane, then come back together for a person to review.",
  brief: "Add a team invite flow",
  decision: "Invite links expire after 24 hours",
  // The same two sentences, broken for printing flat on the plane.
  printTitle: ["Add a team", "invite flow"],
  printNote: ["Invite links expire", "after 24 hours"],
  agents: { ui: "UI agent", api: "API agent" },
  files: { ui: "InviteForm.tsx", api: "invites.ts" },
  token: "POST /invites",
  review: ["Two changes,", "waiting for a person"],
  previous: "Previous step",
  next: "Next step",
  chapters: "Steps",
} as const;

export const messages = {
  accepted: "You’re on the list. We’ll email you when early access opens.",
  confirm: "Check your inbox to confirm your place.",
  failure: "We couldn’t add you yet. Please try again.",
  rateLimited: "Too many attempts just now. Please wait a few minutes and try again.",
  missing: "Enter your email address.",
  format: "Enter an email address like name@company.com.",
  rejected: "We couldn’t use that address. Please check it and try again.",
} as const;

export const faqs = [
  {
    q: "Who is this for?",
    a: "Teams whose coding agents work on the same projects and need a shared understanding of the work.",
  },
  {
    q: "What do agents share?",
    a: "Project context, decisions, file claims and handoffs. Claims make ownership visible, and your team still decides what ships.",
  },
  {
    q: "Where does Covalent work?",
    a: "Covalent works across your team’s coding agents, bringing shared context and coordination to the tools you already use.",
  },
] as const;
