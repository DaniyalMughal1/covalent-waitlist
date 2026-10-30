import type { ProviderOutcome, SubscribeInput, WaitlistProvider } from "../types";

/**
 * CONTROLLED TEST DESTINATION — for verifying the page's UI states only.
 *
 * It is not a waitlist. Nothing is stored anywhere except an in-memory Set that
 * lives as long as the server process (used to simulate "already on the list").
 * Selecting it is refused outside development unless WAITLIST_ALLOW_TEST_PROVIDER=1
 * (see providers/index.ts), and every response it produces carries an
 * `x-waitlist-destination: test-destination` header so testers can tell.
 *
 * Outcome is chosen by the start of the address's local part (case-insensitive):
 *
 *   confirm…   → confirmation_required
 *   duplicate… → duplicate
 *   limit…     → rate_limited (retryAfterSeconds: 30)
 *   fail…      → unavailable
 *   reject…    → rejected
 *   slow…      → waits 2500 ms, then accepted
 *   anything else → new on first use, duplicate on repeats
 *
 * "New" means `accepted` in single opt-in mode and `confirmation_required` in
 * double opt-in mode (WAITLIST_TEST_CONFIRMATION=double-opt-in), mirroring how a
 * real double opt-in provider behaves, so a repeat signup stays publicly
 * indistinguishable from a first one.
 */

export const TEST_DESTINATION_ID = "test-destination";

export const TEST_SLOW_DELAY_MS = 2500;
export const TEST_RATE_LIMIT_RETRY_SECONDS = 30;
/** Upper bound on remembered addresses so a long-running dev server cannot grow without limit. */
const MAX_REMEMBERED = 10_000;

export interface TestDestinationOptions {
  confirmation?: "none" | "double-opt-in";
}

export function createTestDestination(options: TestDestinationOptions = {}): WaitlistProvider {
  const confirmation = options.confirmation ?? "none";
  // Process-lifetime memory only. Never written to disk, logs or browser storage.
  const seen = new Set<string>();

  function remember(email: string): void {
    if (seen.size >= MAX_REMEMBERED) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    seen.add(email);
  }

  return {
    id: TEST_DESTINATION_ID,
    confirmation,
    async subscribe({ email, signal }: SubscribeInput): Promise<ProviderOutcome> {
      const local = email.slice(0, email.lastIndexOf("@")).toLowerCase();

      if (local.startsWith("confirm")) return { kind: "confirmation_required" };
      if (local.startsWith("duplicate")) return { kind: "duplicate" };
      if (local.startsWith("limit")) {
        return { kind: "rate_limited", retryAfterSeconds: TEST_RATE_LIMIT_RETRY_SECONDS };
      }
      if (local.startsWith("fail")) {
        return { kind: "unavailable", reason: "test destination: simulated failure" };
      }
      if (local.startsWith("reject")) return { kind: "rejected" };
      if (local.startsWith("slow")) {
        await wait(TEST_SLOW_DELAY_MS, signal);
        return { kind: "accepted" };
      }

      if (seen.has(email)) return { kind: "duplicate" };
      remember(email);
      return confirmation === "double-opt-in"
        ? { kind: "confirmation_required" }
        : { kind: "accepted" };
    },
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
