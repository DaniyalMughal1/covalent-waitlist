import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { campaignSource, referralCode } from "../attribution";
import { rateLimiterOptionsFromEnv } from "../rate-limit";
import type { ProviderOutcome, WaitlistEnv, WaitlistProvider } from "../types";
import { normalizeEmail } from "../validate";
import { createUnconfiguredProvider } from "./unconfigured";

export function createSupabaseProvider(env: WaitlistEnv): WaitlistProvider {
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!secret?.startsWith("sb_secret_")) {
    return createUnconfiguredProvider("supabase: SUPABASE_SECRET_KEY must be a server secret key");
  }
  let endpoint: URL;
  try {
    const url = new URL(env.SUPABASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("invalid project URL");
    }
    endpoint = new URL("/rest/v1/rpc/join_waitlist", url);
  } catch {
    return createUnconfiguredProvider("supabase: SUPABASE_URL must be the HTTPS project URL");
  }
  const options = rateLimiterOptionsFromEnv(env);
  const limit = Math.min(options.limit, 1000);
  const windowSeconds = Math.min(Math.ceil(options.windowMs / 1000), 86400);

  return {
    id: "supabase",
    confirmation: "none",
    async subscribe(input): Promise<ProviderOutcome> {
      const normalized = normalizeEmail(input.email);
      if (!normalized.ok) return { kind: "rejected" };
      // Use only the address resolved by the server's trusted-proxy policy.
      const address = input.clientAddress?.trim();
      if (!address || !isIP(address)) {
        return { kind: "unavailable", reason: "supabase: trusted client address unavailable" };
      }
      const clientHash = createHmac("sha256", secret)
        .update("covalent-waitlist-rate-limit\0").update(address).digest("hex");
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { apikey: secret, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            p_email: normalized.email,
            p_source: campaignSource(input.acquisitionSource),
            p_referral_code: referralCode(input.referralCode),
            p_client_hash: clientHash,
            p_limit: limit,
            p_window_seconds: windowSeconds,
          }),
          signal: input.signal,
          cache: "no-store",
          redirect: "error",
        });
        if (response.status === 429) return { kind: "rate_limited", retryAfterSeconds: windowSeconds };
        if (!response.ok) return { kind: "unavailable", reason: `supabase: HTTP ${response.status}` };
        const result: unknown = await response.json();
        if (result === "accepted" || result === "duplicate") return { kind: result };
        if (result === "rate_limited") return { kind: result, retryAfterSeconds: windowSeconds };
        if (result === "invalid") return { kind: "rejected" };
        return { kind: "unavailable", reason: "supabase: unexpected signup response" };
      } catch {
        // Never pass upstream bodies or fetch errors (which can contain credentials) to logs.
        return { kind: "unavailable", reason: "supabase: request failed" };
      }
    },
  };
}
