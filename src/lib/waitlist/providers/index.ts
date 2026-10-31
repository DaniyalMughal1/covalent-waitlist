import type { WaitlistEnv, WaitlistProvider } from "../types";
import { createSupabaseProvider } from "./supabase";
import { createTestDestination } from "./test-destination";
import { createUnconfiguredProvider } from "./unconfigured";

export { createTestDestination, TEST_DESTINATION_ID } from "./test-destination";
export { createUnconfiguredProvider, UNCONFIGURED_PROVIDER_ID } from "./unconfigured";

export const TEST_PROVIDER_REFUSED_REASON = "test provider refused outside development";
export const UNKNOWN_PROVIDER_REASON = "unknown WAITLIST_PROVIDER";

/**
 * A factory for a REAL signup destination. It receives the server-side env and
 * returns a provider. If a required secret is missing, return
 * `createUnconfiguredProvider("<id>: <VAR> is not set")` instead of throwing, so
 * the page shows its recoverable failure state and the log names the problem.
 */
export type ProviderFactory = (env: WaitlistEnv) => WaitlistProvider;

const REAL_PROVIDERS: Readonly<Record<string, ProviderFactory>> = {
  supabase: createSupabaseProvider,
};

/**
 * Picks the signup destination from the server-side environment.
 *
 * - WAITLIST_PROVIDER unset/empty → "unconfigured" (every signup → 503 unavailable).
 * - "test" → the controlled test destination, but only in development or when
 *   WAITLIST_ALLOW_TEST_PROVIDER=1; otherwise "unconfigured".
 * - a registered real adapter name → that adapter.
 * - anything else → "unconfigured" with reason "unknown WAITLIST_PROVIDER".
 */
export function selectProvider(env: WaitlistEnv, options: { dev: boolean }): WaitlistProvider {
  const name = (env.WAITLIST_PROVIDER ?? "").trim().toLowerCase();

  if (name === "") return createUnconfiguredProvider();

  if (name === "test") {
    if (options.dev || env.WAITLIST_ALLOW_TEST_PROVIDER === "1") {
      return createTestDestination({
        confirmation:
          env.WAITLIST_TEST_CONFIRMATION?.trim().toLowerCase() === "double-opt-in"
            ? "double-opt-in"
            : "none",
      });
    }
    return createUnconfiguredProvider(TEST_PROVIDER_REFUSED_REASON);
  }

  const factory = Object.prototype.hasOwnProperty.call(REAL_PROVIDERS, name)
    ? REAL_PROVIDERS[name]
    : undefined;
  if (factory) {
    try {
      return factory(env);
    } catch {
      // A broken adapter must degrade to the recoverable failure state, not a 500.
      return createUnconfiguredProvider(`${name}: provider setup failed`);
    }
  }

  return createUnconfiguredProvider(UNKNOWN_PROVIDER_REASON);
}
