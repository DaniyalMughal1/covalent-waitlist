/**
 * Framework-agnostic waitlist signup handler (Request in, Response out).
 *
 * The public contract is documented in docs/WAITLIST-PROVIDER.md. In short:
 * POST JSON or form fields `email` (+ optional `source`); the JSON reply is only
 * ever `{ "status": ... }`, never the email. No-JS form posts get a 303 redirect.
 *
 * Privacy rules enforced here:
 * - The email is never logged, echoed, put in a URL or stored by this module.
 * - The client address is never logged; Supabase stores only a keyed rate-limit digest.
 * - Success is reported only when the configured provider says so.
 */

import { attributionFromUrl, campaignSource, referralCode } from "./attribution";
import { selectProvider, TEST_DESTINATION_ID } from "./providers";
import { rateLimitKey, trustedProxyHopsFromEnv, type RateLimiter } from "./rate-limit";
import {
  SIGNUP_SOURCES,
  type ProviderOutcome,
  type SignupSource,
  type SubscribeInput,
  type WaitlistEnv,
  type WaitlistProvider,
  type WaitlistPublicResponse,
  type WaitlistPublicStatus,
} from "./types";
import { normalizeEmail } from "./validate";

export const MAX_BODY_BYTES = 2048;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;

/** Where no-JS form posts are sent. No email or reason ever goes in these URLs. */
export const NO_JS_LOCATIONS = {
  accepted: "/waitlist/joined/",
  confirmation_required: "/waitlist/confirm/",
  failure: "/waitlist/try-again/",
} as const;

export interface WaitlistLogEntry extends Record<string, unknown> {
  event: "waitlist";
  /** Internal outcome kind, e.g. "accepted", "duplicate", "invalid_email", "provider_timeout". */
  outcome: string;
  /** Provider id, e.g. "unconfigured", "test-destination". */
  provider: string;
  source: SignupSource | null;
  /** Public status sent to the browser. */
  status: WaitlistPublicStatus;
  /** Optional non-email detail (validation reason, provider reason). Redacted defensively. */
  reason?: string;
}

export interface WaitlistHandlerContext {
  /** Server-side environment (never the browser's). */
  env: WaitlistEnv;
  /** True in `astro dev`. Allows the test destination. */
  dev: boolean;
  /**
   * Address from the hosting adapter. The rate-limit key, unless
   * WAITLIST_TRUSTED_PROXY_HOPS is set (see `rateLimitKey`). X-Forwarded-For is
   * never used as a fallback for it.
   */
  clientAddress?: string;
  /** Provider to use. Defaults to `selectProvider(env, { dev })` (a fresh instance per call). */
  provider?: WaitlistProvider;
  /** Rate limiter. Omit to skip local rate limiting (e.g. in unit tests). */
  limiter?: RateLimiter;
  /** Structured logger. Defaults to one `console.info` JSON line per request. */
  log?: (entry: Record<string, unknown>) => void;
  /** Provider timeout in ms. Default 8000. */
  providerTimeoutMs?: number;
}

interface Decision {
  http: number;
  status: WaitlistPublicStatus;
  outcome: string;
  reason?: string;
  retryAfterSeconds?: number;
}

const JSON_TYPE = "application/json";
const URLENCODED_TYPE = "application/x-www-form-urlencoded";
const MULTIPART_TYPE = "multipart/form-data";
const SUPPORTED_TYPES = new Set([JSON_TYPE, URLENCODED_TYPE, MULTIPART_TYPE]);

const defaultLog = (entry: Record<string, unknown>): void => {
  console.info(JSON.stringify(entry));
};

export async function handleWaitlistRequest(
  request: Request,
  ctx: WaitlistHandlerContext,
): Promise<Response> {
  const provider = ctx.provider ?? selectProvider(ctx.env, { dev: ctx.dev });
  const rawContentType = request.headers.get("content-type") ?? "";
  const contentType = mediaType(rawContentType);
  const isPost = request.method.toUpperCase() === "POST";
  const isFormBody = contentType === URLENCODED_TYPE || contentType === MULTIPART_TYPE;
  const wantsJson = (request.headers.get("accept") ?? "").toLowerCase().includes(JSON_TYPE);
  const noJs = isPost && isFormBody && !wantsJson;

  let source: SignupSource | null = null;
  let email: string | undefined;

  const decide = async (): Promise<Decision> => {
    if (!isPost) {
      return { http: 405, status: "invalid", outcome: "method_not_allowed" };
    }

    if (isCrossOrigin(request)) {
      return { http: 403, status: "forbidden", outcome: "cross_origin" };
    }

    if (!SUPPORTED_TYPES.has(contentType)) {
      return { http: 400, status: "invalid", outcome: "unsupported_content_type" };
    }

    let bytes: Uint8Array<ArrayBuffer> | "too_large";
    try {
      bytes = await readBodyCapped(request, MAX_BODY_BYTES);
    } catch {
      return { http: 400, status: "invalid", outcome: "malformed_body" };
    }
    if (bytes === "too_large") {
      return { http: 413, status: "invalid", outcome: "body_too_large" };
    }

    let fields: SignupFields;
    try {
      fields = await parseFields(contentType, rawContentType, bytes);
    } catch {
      return { http: 400, status: "invalid", outcome: "malformed_body" };
    }

    source = parseSource(fields.source) ?? (noJs ? "no-js" : "hero");

    // Rate limit before validation and before the provider, so the endpoint
    // cannot be used to grind either. Malformed bodies above do not consume budget.
    const address = rateLimitKey(
      ctx.clientAddress,
      request.headers.get("x-forwarded-for"),
      trustedProxyHopsFromEnv(ctx.env),
    );
    if (ctx.limiter && address) {
      const decision = ctx.limiter.hit(address);
      if (!decision.allowed) {
        return {
          http: 429,
          status: "rate_limited",
          outcome: "rate_limited_local",
          retryAfterSeconds: decision.retryAfterSeconds,
        };
      }
    }

    const normalized = normalizeEmail(fields.email);
    if (!normalized.ok) {
      return { http: 400, status: "invalid", outcome: "invalid_email", reason: normalized.reason };
    }
    email = normalized.email;

    const attribution = referralAttribution(request);
    const result = await callProvider(
      provider,
      {
        email,
        source,
        clientAddress: address,
        acquisitionSource: campaignSource(fields.utm_source ?? attribution?.utm_source),
        referralCode: referralCode(fields.referral_code ?? attribution?.referral_code),
      },
      ctx.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    );
    if (result.type === "timeout") {
      return { http: 503, status: "unavailable", outcome: "provider_timeout" };
    }
    if (result.type === "error") {
      return { http: 503, status: "unavailable", outcome: "provider_error", reason: result.reason };
    }
    return mapOutcome(result.outcome, provider);
  };

  let decision: Decision;
  try {
    decision = await decide();
  } catch (error) {
    // Anything unexpected (a misbehaving adapter, a hostile thrown value) still gets
    // the public 503 JSON contract with no-store, never a framework 500 page.
    decision = {
      http: 503,
      status: "unavailable",
      outcome: "internal_error",
      reason: describeError(error),
    };
  }

  const entry: WaitlistLogEntry = {
    event: "waitlist",
    outcome: decision.outcome,
    provider: provider.id,
    source,
    status: decision.status,
  };
  if (decision.reason) entry.reason = redact(decision.reason, email);
  try {
    (ctx.log ?? defaultLog)(entry);
  } catch {
    // Logging must never change the user's outcome.
  }

  return respond(decision, provider, noJs);
}

// ---------------------------------------------------------------------------
// Outcome mapping
// ---------------------------------------------------------------------------

function mapOutcome(outcome: ProviderOutcome, provider: WaitlistProvider): Decision {
  // Guard against adapters returning something outside the union at runtime.
  const kind = (outcome as { kind?: unknown } | null | undefined)?.kind;
  switch (kind) {
    case "accepted":
      return { http: 200, status: "accepted", outcome: "accepted" };
    case "confirmation_required":
      return { http: 200, status: "confirmation_required", outcome: "confirmation_required" };
    case "duplicate":
      // Publicly identical to a new signup in the provider's mode.
      return {
        http: 200,
        status: provider.confirmation === "double-opt-in" ? "confirmation_required" : "accepted",
        outcome: "duplicate",
      };
    case "rejected":
      return { http: 400, status: "invalid", outcome: "provider_rejected" };
    case "rate_limited": {
      const retry = (outcome as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      const decision: Decision = { http: 429, status: "rate_limited", outcome: "provider_rate_limited" };
      if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) {
        decision.retryAfterSeconds = Math.ceil(retry);
      }
      return decision;
    }
    case "unavailable": {
      const reason = (outcome as { reason?: unknown }).reason;
      return {
        http: 503,
        status: "unavailable",
        outcome: "provider_unavailable",
        reason: typeof reason === "string" ? reason : undefined,
      };
    }
    default:
      return { http: 503, status: "unavailable", outcome: "provider_bad_outcome" };
  }
}

type CallResult =
  | { type: "outcome"; outcome: ProviderOutcome }
  | { type: "timeout" }
  | { type: "error"; reason: string };

async function callProvider(
  provider: WaitlistProvider,
  input: Omit<SubscribeInput, "signal">,
  timeoutMs: number,
): Promise<CallResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<CallResult>((resolve) => {
    timer = setTimeout(() => {
      // Settle first, then abort, so the timeout always wins the race.
      resolve({ type: "timeout" });
      controller.abort(new Error("waitlist provider timeout"));
    }, timeoutMs);
  });

  const attempt = (async (): Promise<CallResult> => {
    try {
      const outcome = await provider.subscribe({ ...input, signal: controller.signal });
      return { type: "outcome", outcome };
    } catch (error) {
      return { type: "error", reason: describeError(error) };
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Response building
// ---------------------------------------------------------------------------

function respond(decision: Decision, provider: WaitlistProvider, noJs: boolean): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (provider.id === TEST_DESTINATION_ID) headers.set("x-waitlist-destination", provider.id);

  if (noJs) {
    headers.set("location", noJsLocation(decision.status));
    return new Response(null, { status: 303, headers });
  }

  if (decision.http === 405) headers.set("allow", "POST");
  if (decision.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(decision.retryAfterSeconds));
  }
  headers.set("content-type", "application/json; charset=utf-8");
  const body: WaitlistPublicResponse = { status: decision.status };
  return new Response(JSON.stringify(body), { status: decision.http, headers });
}

function noJsLocation(status: WaitlistPublicStatus): string {
  if (status === "accepted") return NO_JS_LOCATIONS.accepted;
  if (status === "confirmation_required") return NO_JS_LOCATIONS.confirmation_required;
  return NO_JS_LOCATIONS.failure;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

function mediaType(header: string): string {
  return (header.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Same-origin guard (CSRF). Mirrors Astro's own origin check:
 *
 * 1. `Sec-Fetch-Site` is set by the browser and cannot be forged by page script.
 *    "same-origin"/"none" → allowed; "same-site"/"cross-site" → forbidden.
 *    This matters because behind a proxy, or without `security.allowedDomains`
 *    in astro.config, Astro builds `request.url` with a `localhost:<port>` host,
 *    so an Origin-vs-URL comparison alone would reject every real browser.
 * 2. Otherwise (older browsers, non-browser clients): if an Origin header is
 *    present, its host must equal the request URL's host. Scheme is ignored so a
 *    TLS-terminating proxy does not cause false rejections.
 */
function isCrossOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "none") return false;
  if (fetchSite === "same-site" || fetchSite === "cross-site") return true;

  const origin = request.headers.get("origin");
  return origin !== null && !isSameHost(origin, request.url);
}

function isSameHost(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    // Includes the opaque "null" origin.
    return false;
  }
}

async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | "too_large"> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    return "too_large";
  }
  if (request.body === null) return new Uint8Array(0);

  // Read incrementally so a missing or lying Content-Length cannot make us buffer more than the cap.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface SignupFields {
  email: unknown;
  source: unknown;
  utm_source: unknown;
  referral_code: unknown;
}

async function parseFields(
  contentType: string,
  rawContentType: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<SignupFields> {
  if (contentType === JSON_TYPE) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object");
    }
    const record = parsed as Record<string, unknown>;
    return {
      email: record.email, source: record.source,
      utm_source: record.utm_source, referral_code: record.referral_code,
    };
  }

  if (contentType === URLENCODED_TYPE) {
    const params = new URLSearchParams(new TextDecoder().decode(bytes));
    return {
      email: params.get("email"), source: params.get("source"),
      utm_source: params.get("utm_source"), referral_code: params.get("referral_code"),
    };
  }

  // multipart/form-data: let the platform parser handle boundaries.
  const form = await new Response(bytes, { headers: { "content-type": rawContentType } }).formData();
  return {
    email: form.get("email"), source: form.get("source"),
    utm_source: form.get("utm_source"), referral_code: form.get("referral_code"),
  };
}

/** Native form submissions can retain campaign attribution from a same-host page. */
function referralAttribution(request: Request) {
  try {
    const referrer = new URL(request.headers.get("referer") ?? "");
    if (referrer.host === new URL(request.url).host) return attributionFromUrl(referrer);
  } catch {
    // Missing or invalid referrer simply means direct traffic.
  }
  return undefined;
}

function parseSource(value: unknown): SignupSource | undefined {
  return typeof value === "string" && (SIGNUP_SOURCES as readonly string[]).includes(value)
    ? (value as SignupSource)
    : undefined;
}

// ---------------------------------------------------------------------------
// Log hygiene
// ---------------------------------------------------------------------------

/**
 * One-line description of a thrown value. Must never throw itself: `name` or
 * `message` may be a Symbol, an object without a prototype, or a throwing getter.
 */
function describeError(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "non-Error value thrown";
    const name: unknown = error.name;
    const message: unknown = error.message;
    return `${typeof name === "string" ? name : "Error"}: ${
      typeof message === "string" ? message : "(non-string message)"
    }`;
  } catch {
    return "unreadable thrown value";
  }
}

const EMAIL_LIKE = /[^\s@]+@[^\s@]+/g;
/** Percent-encoded addresses, e.g. inside a URL quoted in an upstream error message. */
const ENCODED_EMAIL_LIKE = /[^\s?&=/"'<>]+%40[^\s?&/"'<>]+/gi;

/** Removes anything address-shaped from a log reason, flattens it to one line and caps its length. */
function redact(text: string, email: string | undefined): string {
  let out = text;
  if (email) out = out.split(email).join("[redacted]");
  out = out
    .replace(EMAIL_LIKE, "[redacted]")
    .replace(ENCODED_EMAIL_LIKE, "[redacted]")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  return out.length > 200 ? `${out.slice(0, 200)}…` : out;
}
