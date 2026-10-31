import type { WaitlistEnv } from "./types";

/**
 * Best-effort, in-memory sliding-window rate limiter keyed by client address.
 *
 * Limits and caveats (read before relying on it):
 * - Per process. Each server instance, serverless invocation or worker keeps its
 *   own counts, and a restart forgets them. It slows down casual abuse of a
 *   single instance; it is not a distributed limiter.
 * - The Supabase adapter adds an atomic database counter across instances.
 *   Hosting edge/WAF limits can further reduce abusive traffic.
 * - Addresses are held in memory only for the length of the window. They are
 *   never logged or persisted.
 * - The key is only as trustworthy as the address it is given. See
 *   `rateLimitKey` below and "Deployment notes" in docs/WAITLIST-PROVIDER.md.
 * - Memory is bounded: expired keys are pruned periodically and the map never
 *   holds more than `maxKeys` addresses (oldest-touched are evicted first).
 */

export const DEFAULT_RATE_LIMIT = 20;
export const DEFAULT_RATE_WINDOW_SECONDS = 600;
export const DEFAULT_MAX_KEYS = 10_000;

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Records one attempt for `key` and says whether it is allowed. Denied attempts are not counted. */
  hit(key: string): RateLimitDecision;
}

export interface RateLimiterOptions {
  /** Attempts allowed per window. Default 20 (small teams often share one office address). */
  limit?: number;
  /** Window length in milliseconds. Default 10 minutes. */
  windowMs?: number;
  /** Hard cap on tracked addresses. Default 10,000. */
  maxKeys?: number;
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = positiveIntOr(options.limit, DEFAULT_RATE_LIMIT);
  const windowMs = positiveIntOr(options.windowMs, DEFAULT_RATE_WINDOW_SECONDS * 1000);
  const maxKeys = positiveIntOr(options.maxKeys, DEFAULT_MAX_KEYS);
  const now = options.now ?? Date.now;

  // key → timestamps (ms) of allowed attempts inside the window, oldest first.
  // Map iteration order is insertion order; keys are re-inserted on every hit so
  // the first entries are the least recently touched.
  const attempts = new Map<string, number[]>();
  let lastPrune = 0;

  function prune(at: number): void {
    const cutoff = at - windowMs;
    for (const [key, stamps] of attempts) {
      const newest = stamps[stamps.length - 1];
      if (newest === undefined || newest <= cutoff) attempts.delete(key);
    }
    lastPrune = at;
  }

  return {
    hit(key: string): RateLimitDecision {
      const at = now();
      // Sweep expired keys at most once per window; the LRU cap below bounds memory in between.
      if (at - lastPrune >= windowMs) prune(at);

      const cutoff = at - windowMs;
      const stamps = (attempts.get(key) ?? []).filter((t) => t > cutoff);

      if (stamps.length >= limit) {
        attempts.delete(key);
        attempts.set(key, stamps);
        const oldest = stamps[0] ?? at;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - at) / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      stamps.push(at);
      attempts.delete(key);
      while (attempts.size >= maxKeys) {
        const lru = attempts.keys().next();
        if (lru.done) break;
        attempts.delete(lru.value);
      }
      attempts.set(key, stamps);
      return { allowed: true };
    },
  };
}

/**
 * Reads WAITLIST_TRUSTED_PROXY_HOPS: how many reverse proxies in front of the
 * server append the connecting address to `X-Forwarded-For`. Default 0 (none
 * trusted). Anything other than a non-negative integer falls back to 0.
 */
export function trustedProxyHopsFromEnv(env: WaitlistEnv): number {
  const hops = parseIntStrict(env.WAITLIST_TRUSTED_PROXY_HOPS);
  return hops !== undefined && Number.isSafeInteger(hops) ? hops : 0;
}

/**
 * Picks the address the limiter is keyed on.
 *
 * - `trustedProxyHops` = 0 (default): the hosting adapter's client address, and
 *   nothing else. `X-Forwarded-For` is never read, because the visitor can write it.
 * - `trustedProxyHops` = N > 0: the N-th entry from the RIGHT of `X-Forwarded-For`.
 *   Each trusted proxy appends the address that connected to it, so that entry was
 *   written by the outermost trusted proxy and cannot be forged. Entries further
 *   left came from the visitor and are ignored. This deliberately does not use the
 *   adapter's address, because Astro reports the LEFT-most (forgeable) entry once
 *   `security.allowedDomains` is set. If the header has fewer than N entries, the
 *   request did not pass through every trusted proxy, and the adapter's address is
 *   used instead.
 *
 * Returns undefined when no address is known (the limiter is then skipped rather
 * than putting every visitor into one shared bucket).
 */
export function rateLimitKey(
  clientAddress: string | undefined,
  forwardedFor: string | null | undefined,
  trustedProxyHops: number,
): string | undefined {
  if (trustedProxyHops > 0 && forwardedFor) {
    const entries = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length >= trustedProxyHops) {
      const trusted = entries[entries.length - trustedProxyHops];
      if (trusted) return trusted;
    }
  }
  const direct = clientAddress?.trim();
  return direct ? direct : undefined;
}

/** Reads WAITLIST_RATE_LIMIT (count) and WAITLIST_RATE_WINDOW_SECONDS; invalid values fall back to defaults. */
export function rateLimiterOptionsFromEnv(env: WaitlistEnv): Required<Pick<RateLimiterOptions, "limit" | "windowMs">> {
  const limit = positiveIntOr(parseIntStrict(env.WAITLIST_RATE_LIMIT), DEFAULT_RATE_LIMIT);
  const windowSeconds = positiveIntOr(
    parseIntStrict(env.WAITLIST_RATE_WINDOW_SECONDS),
    DEFAULT_RATE_WINDOW_SECONDS,
  );
  return { limit, windowMs: windowSeconds * 1000 };
}

function parseIntStrict(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function positiveIntOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
