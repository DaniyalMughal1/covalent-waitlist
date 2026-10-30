import type { WaitlistProvider } from "../types";

export const UNCONFIGURED_PROVIDER_ID = "unconfigured";
export const UNCONFIGURED_DEFAULT_REASON = "WAITLIST_PROVIDER is not set";

/**
 * The provider used whenever no real destination is configured (or the
 * configured one was refused). It never pretends to succeed: every signup is
 * answered "unavailable", which the endpoint turns into a 503 so the page shows
 * its recoverable "We couldn't add you yet" state.
 */
export function createUnconfiguredProvider(
  reason: string = UNCONFIGURED_DEFAULT_REASON,
): WaitlistProvider {
  return {
    id: UNCONFIGURED_PROVIDER_ID,
    confirmation: "none",
    async subscribe() {
      return { kind: "unavailable", reason };
    },
  };
}
