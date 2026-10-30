/**
 * Waitlist signup boundary: shared types.
 *
 * The browser only ever sees `WaitlistPublicResponse`. Providers (real email
 * platforms, the controlled test destination, or the "unconfigured" stub) speak
 * `ProviderOutcome`, and the handler maps one to the other. See
 * docs/WAITLIST-PROVIDER.md for the full contract.
 */

/** Which form on the page sent the signup. Never contains user data. */
export type SignupSource = "hero" | "final" | "no-js";

export const SIGNUP_SOURCES: readonly SignupSource[] = ["hero", "final", "no-js"];

/** What a provider adapter reports back after trying to add an address. */
export type ProviderOutcome =
  | { kind: "accepted" }
  | { kind: "confirmation_required" }
  | { kind: "duplicate" }
  | { kind: "rejected" }
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  | { kind: "unavailable"; reason: string };

export interface SubscribeInput {
  /** Normalized address (trimmed, domain lowercased). Never log or persist it outside the provider. */
  email: string;
  source: SignupSource;
  /**
   * Aborted when the handler gives up waiting (provider timeout). Adapters should
   * pass it to `fetch` so a slow upstream request is cancelled. Optional for
   * adapters that do not need it.
   */
  signal?: AbortSignal;
}

export interface WaitlistProvider {
  /** Stable, non-secret identifier, e.g. "unconfigured", "test-destination". Safe to log. */
  readonly id: string;
  /**
   * "none": a new signup is final once accepted (single opt-in).
   * "double-opt-in": the provider emails a confirmation link first.
   * Drives how a duplicate is reported publicly, so duplicates are indistinguishable
   * from new signups.
   */
  readonly confirmation: "none" | "double-opt-in";
  subscribe(input: SubscribeInput): Promise<ProviderOutcome>;
}

/** Every status the endpoint can return in its JSON body. */
export type WaitlistPublicStatus =
  | "accepted"
  | "confirmation_required"
  | "invalid"
  | "rate_limited"
  | "unavailable"
  | "forbidden";

/** The only JSON shape the endpoint ever returns. It never echoes the email. */
export interface WaitlistPublicResponse {
  status: WaitlistPublicStatus;
}

/** Minimal env shape the waitlist code reads. Values are strings or absent. */
export type WaitlistEnv = Record<string, string | undefined>;
