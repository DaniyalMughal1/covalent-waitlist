/**
 * POST /api/waitlist — the only on-demand route. Thin Astro wrapper around the
 * framework-agnostic handler in src/lib/waitlist/handler.ts; the contract is in
 * docs/WAITLIST-PROVIDER.md.
 *
 * Env note: configuration is read from the runtime process environment first,
 * with Astro's `import.meta.env` underneath it (that is what carries `.env`
 * files during `astro dev`). Avoid writing env variable names in this file:
 * Astro's build inlines the build machine's value for any private env name that
 * appears literally in a module that reads the whole `import.meta.env` object.
 */
import type { APIContext, APIRoute } from "astro";
import { handleWaitlistRequest } from "../../lib/waitlist/handler";
import { selectProvider } from "../../lib/waitlist/providers";
import { createRateLimiter, rateLimiterOptionsFromEnv, type RateLimiter } from "../../lib/waitlist/rate-limit";
import type { WaitlistEnv, WaitlistProvider } from "../../lib/waitlist/types";

export const prerender = false;

const dev = import.meta.env.DEV;

// Module-level singletons: one limiter and one provider per server process, so
// rate-limit counts (and the test destination's in-memory "already joined" set)
// survive across requests. Created lazily on the first request.
let env: WaitlistEnv | undefined;
let limiter: RateLimiter | undefined;
let provider: WaitlistProvider | undefined;

function serverEnv(): WaitlistEnv {
  if (env) return env;
  const merged: WaitlistEnv = {};
  const buildTime = import.meta.env as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(buildTime)) {
    if (typeof value === "string") merged[key] = value;
  }
  const runtime = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (runtime) {
    for (const [key, value] of Object.entries(runtime)) {
      if (typeof value === "string") merged[key] = value;
    }
  }
  env = merged;
  return merged;
}

function clientAddressOf(context: APIContext): string | undefined {
  try {
    const address = context.clientAddress;
    return typeof address === "string" && address.length > 0 ? address : undefined;
  } catch {
    // Some adapters/prerender contexts throw instead of returning undefined.
    return undefined;
  }
}

const handle: APIRoute = (context) => {
  const currentEnv = serverEnv();
  limiter ??= createRateLimiter(rateLimiterOptionsFromEnv(currentEnv));
  provider ??= selectProvider(currentEnv, { dev });
  return handleWaitlistRequest(context.request, {
    env: currentEnv,
    dev,
    clientAddress: clientAddressOf(context),
    provider,
    limiter,
  });
};

export const POST: APIRoute = handle;

/** Every other method gets 405 with `Allow: POST` (the handler builds it). */
export const ALL: APIRoute = handle;
