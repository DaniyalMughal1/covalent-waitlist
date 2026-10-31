// Waitlist forms: inline validation, one request at a time, and states that reflect the
// server's actual response (see docs/WAITLIST-PROVIDER.md). Emails are never written to
// storage, the URL or logs; they only travel in the POST body.
import { attributionFromUrl } from "../lib/waitlist/attribution";
import { copy, messages } from "../config/site";
import { normalizeEmail } from "../lib/waitlist/validate";
import { scrollToElement } from "./smooth-scroll";

export type FormState = "idle" | "invalid" | "submitting" | "accepted" | "confirm" | "failed";
export interface WaitlistStateDetail {
  source: string;
  state: FormState;
}

const ENDPOINT = "/api/waitlist";
const TIMEOUT_MS = 15_000;

const forms = [...document.querySelectorAll<HTMLFormElement>("form[data-waitlist]")];
let inFlight: HTMLFormElement | null = null;
// Forms submitted while another request was on its way. They are answered after it.
const queued = new Set<HTMLFormElement>();

const parts = (form: HTMLFormElement) => ({
  input: form.querySelector<HTMLInputElement>('input[type="email"]')!,
  button: form.querySelector<HTMLButtonElement>('button[type="submit"]')!,
  error: form.querySelector<HTMLElement>("[data-error]")!,
  status: form.querySelector<HTMLElement>("[data-status]")!,
  success: form.querySelector<HTMLElement>("[data-success-text]")!,
  source: (form.querySelector<HTMLInputElement>('input[name="source"]')?.value ?? "hero").slice(0, 16),
});

const isDone = (form: HTMLFormElement) => form.dataset.state === "accepted" || form.dataset.state === "confirm";

const isOnScreen = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.top >= 0 && box.bottom <= window.innerHeight;
};

function setState(form: HTMLFormElement, state: FormState, message = "") {
  const { input, button, error, status, success } = parts(form);
  form.dataset.state = state;
  // ARIA reads an empty value as false, so these are set explicitly or removed.
  if (state === "submitting") form.setAttribute("aria-busy", "true");
  else form.removeAttribute("aria-busy");
  button.setAttribute("aria-disabled", String(state === "submitting"));
  // The answer will be about this address, so it stays put until the answer lands.
  input.readOnly = state === "submitting";

  if (state === "invalid") input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  error.textContent = state === "invalid" ? message : "";
  status.textContent = state === "submitting" || state === "failed" ? message : "";
  // A success is read out when focus moves to it, not through a live region.
  success.textContent = state === "accepted" || state === "confirm" ? message : "";

  document.dispatchEvent(
    new CustomEvent<WaitlistStateDetail>("waitlist:state", { detail: { source: parts(form).source, state } }),
  );
}

async function submit(form: HTMLFormElement) {
  const { input, source } = parts(form);
  // The same permissive rules the server applies; no browser-specific email check.
  const checked = normalizeEmail(input.value);
  if (!checked.ok) {
    setState(form, "invalid", checked.reason === "missing" ? messages.missing : messages.format);
    input.focus();
    return;
  }

  // One request at a time across both forms.
  inFlight = form;
  setState(form, "submitting", copy.busy);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status = "unavailable";
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        email: input.value.trim(), source,
        ...attributionFromUrl(new URL(window.location.href)),
      }),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === "object" && "status" in body && typeof body.status === "string") {
      status = body.status;
    }
    // A success status only counts when the HTTP response agrees.
    if ((status === "accepted" || status === "confirmation_required") && !response.ok) status = "unavailable";
  } catch {
    status = "unavailable";
  } finally {
    window.clearTimeout(timer);
    inFlight = null;
  }
  // Once this answer is shown, run anything submitted meanwhile.
  const next = [...queued];
  queued.clear();
  window.setTimeout(() => {
    for (const other of next) {
      if (isDone(other)) continue;
      const theirs = normalizeEmail(parts(other).input.value);
      // The same address was just answered below, and that answer covers this form too.
      if (theirs.ok && theirs.email === checked.email) continue;
      if (!inFlight) void submit(other);
    }
  }, 0);

  if (status === "accepted" || status === "confirmation_required") {
    const state: FormState = status === "accepted" ? "accepted" : "confirm";
    const text = state === "accepted" ? messages.accepted : messages.confirm;
    // The other form shows the same result only if it holds the same address, so
    // nobody is asked twice and nothing is claimed for an address never sent.
    for (const other of forms) {
      const theirs = normalizeEmail(parts(other).input.value);
      if (other === form || (theirs.ok && theirs.email === checked.email)) setState(other, state, text);
    }
    // An answer can land long after the visitor has moved on. It never pulls them back, and
    // never takes the cursor from someone typing somewhere else. A form that has just gone to
    // its note has hidden whatever held focus, so focus moves to that note, not to nowhere.
    const active = document.activeElement;
    const answered = forms.find((other) => isDone(other) && other.contains(active));
    if (answered) parts(answered).success.focus({ preventScroll: true });
    else if (!active || active === document.body) parts(form).success.focus({ preventScroll: true });
    return;
  }

  // Every other answer is about the address, so each form still holding it says the same.
  const holding = forms.filter((other) => {
    const theirs = normalizeEmail(parts(other).input.value);
    return other === form || (!isDone(other) && theirs.ok && theirs.email === checked.email);
  });
  // Unlike a success, these need something done, so they have to be seen. Only someone busy
  // typing elsewhere is left where they are.
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement && !form.contains(active);
  if (status === "invalid") {
    holding.forEach((other) => setState(other, "invalid", messages.rejected));
    if (!typing) input.focus();
    return;
  }
  const text = status === "rate_limited" ? messages.rateLimited : messages.failure;
  holding.forEach((other) => setState(other, "failed", text));
  if (!typing && !holding.some((other) => isOnScreen(parts(other).status))) {
    scrollToElement(form, "center");
  }
}

for (const form of forms) {
  // Native validation stays on without JavaScript; with it, errors are inline.
  form.noValidate = true;
  const { input } = parts(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.dataset.state === "submitting") return;
    if (inFlight) {
      // One request at a time: this one waits for the answer to the other form.
      if (normalizeEmail(parts(form).input.value).ok) {
        queued.add(form);
        setState(form, "submitting", copy.busy);
      } else {
        void submit(form); // shows the inline error; nothing is sent
      }
      return;
    }
    void submit(form);
  });

  input.addEventListener("input", () => {
    // Typing starts over: any message about the previous attempt goes away.
    if (form.dataset.state === "invalid" || form.dataset.state === "failed") setState(form, "idle");
    // Keep the repeated forms in step, so an address typed above is ready below.
    for (const other of forms) {
      if (other === form || other === inFlight || isDone(other)) continue;
      const otherInput = parts(other).input;
      if (otherInput === document.activeElement) continue;
      otherInput.value = input.value;
      if (other.dataset.state !== "idle") setState(other, "idle");
    }
  });
}

// Coming back through the back/forward cache: a request that never finished is gone.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const form of forms) if (form.dataset.state === "submitting") setState(form, "idle");
});
