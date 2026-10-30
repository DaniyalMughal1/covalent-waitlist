// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  handleWaitlistRequest,
  MAX_BODY_BYTES,
  type WaitlistHandlerContext,
} from "./handler";
import {
  createTestDestination,
  selectProvider,
  TEST_DESTINATION_ID,
  UNCONFIGURED_PROVIDER_ID,
} from "./providers";
import {
  createRateLimiter,
  rateLimiterOptionsFromEnv,
  rateLimitKey,
  trustedProxyHopsFromEnv,
} from "./rate-limit";
import type { ProviderOutcome, SubscribeInput, WaitlistProvider } from "./types";
import { normalizeEmail } from "./validate";

const SITE = "https://covalent.test";
const ENDPOINT = `${SITE}/api/waitlist`;
const EMAIL = "person@example.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeProvider = WaitlistProvider & { calls: SubscribeInput[] };

function fakeProvider(
  result: ProviderOutcome | ((input: SubscribeInput) => Promise<ProviderOutcome>),
  confirmation: WaitlistProvider["confirmation"] = "none",
): FakeProvider {
  const calls: SubscribeInput[] = [];
  return {
    id: "fake",
    confirmation,
    calls,
    async subscribe(input) {
      calls.push(input);
      return typeof result === "function" ? result(input) : result;
    },
  };
}

function jsonRequest(
  body: unknown,
  options: { headers?: Record<string, string>; method?: string } = {},
): Request {
  return new Request(ENDPOINT, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function formRequest(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

interface CallResult {
  res: Response;
  text: string;
  body: unknown;
  logs: Record<string, unknown>[];
}

async function call(request: Request, ctx: Partial<WaitlistHandlerContext> = {}): Promise<CallResult> {
  const logs: Record<string, unknown>[] = [];
  const res = await handleWaitlistRequest(request, {
    env: {},
    dev: false,
    log: (entry) => logs.push(entry),
    ...ctx,
  });
  const text = await res.clone().text();
  let body: unknown = null;
  if (text) body = JSON.parse(text);
  return { res, text, body, logs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Provider outcome mapping
// ---------------------------------------------------------------------------

describe("provider outcome mapping", () => {
  it("accepted → 200 accepted, JSON, no-store, normalized email passed to provider", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const { res, body } = await call(jsonRequest({ email: "  Person@Example.COM ", source: "final" }), {
      provider,
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "accepted" });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-waitlist-destination")).toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.email).toBe("Person@example.com");
    expect(provider.calls[0]?.source).toBe("final");
  });

  it("confirmation_required → 200 confirmation_required", async () => {
    const { res, body } = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "confirmation_required" }, "double-opt-in"),
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "confirmation_required" });
  });

  it("duplicate looks like a new signup in single opt-in mode (accepted)", async () => {
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "duplicate" }, "none"),
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "accepted" });
    expect(logs[0]?.outcome).toBe("duplicate");
  });

  it("duplicate looks like a new signup in double opt-in mode (confirmation_required)", async () => {
    const { res, body } = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "duplicate" }, "double-opt-in"),
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "confirmation_required" });
  });

  it("rejected → 400 invalid", async () => {
    const { res, body } = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "rejected" }),
    });
    expect(res.status).toBe(400);
    expect(body).toEqual({ status: "invalid" });
  });

  it("provider rate_limited → 429 with Retry-After when known", async () => {
    const withRetry = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "rate_limited", retryAfterSeconds: 12.2 }),
    });
    expect(withRetry.res.status).toBe(429);
    expect(withRetry.body).toEqual({ status: "rate_limited" });
    expect(withRetry.res.headers.get("retry-after")).toBe("13");

    const withoutRetry = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "rate_limited" }),
    });
    expect(withoutRetry.res.status).toBe(429);
    expect(withoutRetry.res.headers.get("retry-after")).toBeNull();
  });

  it("provider unavailable → 503 unavailable", async () => {
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "unavailable", reason: "upstream 502" }),
    });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(logs[0]).toMatchObject({ outcome: "provider_unavailable", reason: "upstream 502" });
  });

  it("provider throws → 503 unavailable, error logged without the email", async () => {
    const provider = fakeProvider(async (input) => {
      throw new TypeError(`fetch failed for ${input.email}`);
    });
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), { provider });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(logs[0]?.outcome).toBe("provider_error");
    expect(String(logs[0]?.reason)).toContain("TypeError");
    expect(JSON.stringify(logs)).not.toContain(EMAIL);
  });

  it("hostile thrown values still give the 503 JSON contract, never a crash", async () => {
    const symbolMessage = new Error("x");
    Object.defineProperty(symbolMessage, "message", { value: Symbol("boom") });
    const objectMessage = new Error("x");
    Object.defineProperty(objectMessage, "message", { value: Object.create(null) });
    const symbolName = new Error("x");
    Object.defineProperty(symbolName, "name", { value: Symbol("name") });
    const throwingGetter = new Error("x");
    Object.defineProperty(throwingGetter, "message", {
      get() {
        throw new Error("getter exploded");
      },
    });
    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap exploded");
        },
      },
    );

    const cases: Array<[unknown, string]> = [
      [symbolMessage, "Error: (non-string message)"],
      [objectMessage, "Error: (non-string message)"],
      [symbolName, "Error: x"],
      [throwingGetter, "unreadable thrown value"],
      [hostileProxy, "unreadable thrown value"],
      [Symbol("raw"), "non-Error value thrown"],
    ];
    for (const [thrown, reason] of cases) {
      for (const sync of [false, true]) {
        const provider: WaitlistProvider = {
          id: "fake",
          confirmation: "none",
          subscribe: sync
            ? () => {
                throw thrown;
              }
            : async () => {
                throw thrown;
              },
        };
        const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), { provider });
        expect(res.status).toBe(503);
        expect(body).toEqual({ status: "unavailable" });
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(logs[0]).toMatchObject({ outcome: "provider_error", reason });
      }
    }
  });

  it("an unexpected throw anywhere in the pipeline → 503 JSON (no-store), or the try-again redirect", async () => {
    const hostileOutcome = {
      get kind(): string {
        throw new Error(`kind getter failed for ${EMAIL}`);
      },
    } as unknown as ProviderOutcome;
    const provider = fakeProvider(async () => hostileOutcome);

    const json = await call(jsonRequest({ email: EMAIL }), { provider });
    expect(json.res.status).toBe(503);
    expect(json.body).toEqual({ status: "unavailable" });
    expect(json.res.headers.get("cache-control")).toBe("no-store");
    expect(json.logs[0]).toMatchObject({ outcome: "internal_error", status: "unavailable" });
    expect(JSON.stringify(json.logs)).not.toContain(EMAIL);

    const form = await call(formRequest({ email: EMAIL }), { provider });
    expect(form.res.status).toBe(303);
    expect(form.res.headers.get("location")).toBe("/waitlist/try-again/");
  });

  it("provider returning garbage → 503 unavailable", async () => {
    const provider = fakeProvider(async () => ({ kind: "great" }) as unknown as ProviderOutcome);
    const { res, logs } = await call(jsonRequest({ email: EMAIL }), { provider });
    expect(res.status).toBe(503);
    expect(logs[0]?.outcome).toBe("provider_bad_outcome");
  });

  it("provider timeout (injected short timeout) → 503 and the provider signal is aborted", async () => {
    let seenSignal: AbortSignal | undefined;
    const provider = fakeProvider((input) => {
      seenSignal = input.signal;
      return new Promise<ProviderOutcome>(() => undefined);
    });
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), {
      provider,
      providerTimeoutMs: 20,
    });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(logs[0]?.outcome).toBe("provider_timeout");
    expect(seenSignal?.aborted).toBe(true);
  });

  it("enforces the default 8 s provider timeout (fake timers)", async () => {
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBe(8000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let markCalled: () => void = () => undefined;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    const provider: WaitlistProvider = {
      id: "hang",
      confirmation: "none",
      subscribe: () => {
        markCalled();
        return new Promise<ProviderOutcome>(() => undefined);
      },
    };
    let settled = false;
    const pending = handleWaitlistRequest(jsonRequest({ email: EMAIL }), {
      env: {},
      dev: false,
      provider,
      log: () => undefined,
    }).then((res) => {
      settled = true;
      return res;
    });
    await called;
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("email validation", () => {
  it.each([
    "o'brien+tag@sub.example.co.uk",
    "x@xn--bcher-kva.example",
    "first.last@example.com",
    '"quoted@local"@example.com',
    "user@bücher.example",
    `${"a".repeat(64)}@example.com`,
  ])("accepts %s", (address) => {
    const result = normalizeEmail(address);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["no-at-sign", "format"],
    ["a@b", "format"],
    [" @example.com", "format"],
    ["a b@example.com", "format"],
    ["a@.example.com", "format"],
    ["a@example.com.", "format"],
    ["a@", "format"],
    ["a@exa\u0000mple.com", "format"],
    ["a@exa\tmple.com", "format"],
    ["a b@example.com", "format"],
    ["", "missing"],
    ["   ", "missing"],
    [`${"a".repeat(65)}@example.com`, "length"],
    [`a@${"b".repeat(250)}.com`, "length"],
  ] as const)("rejects %j (%s)", (address, reason) => {
    expect(normalizeEmail(address)).toEqual({ ok: false, reason });
  });

  it("treats non-strings as missing", () => {
    for (const value of [undefined, null, 42, {}, ["a@b.co"]]) {
      expect(normalizeEmail(value)).toEqual({ ok: false, reason: "missing" });
    }
  });

  it("trims and lowercases only the domain, splitting on the last @", () => {
    expect(normalizeEmail("  Mixed.Case@Sub.EXAMPLE.Com\n")).toEqual({
      ok: true,
      email: "Mixed.Case@sub.example.com",
    });
    expect(normalizeEmail('"A@B"@Example.ORG')).toEqual({ ok: true, email: '"A@B"@example.org' });
  });

  it("passes permissive-but-valid addresses through the handler", async () => {
    for (const address of ["o'brien+tag@sub.example.co.uk", "x@xn--bcher-kva.example"]) {
      const provider = fakeProvider({ kind: "accepted" });
      const { res } = await call(jsonRequest({ email: address }), { provider });
      expect(res.status).toBe(200);
      expect(provider.calls[0]?.email).toBe(address);
    }
  });

  it.each(["no-at-sign", "a@b", " @example.com", "a b@example.com"])(
    "handler answers 400 invalid for %j without calling the provider",
    async (address) => {
      const provider = fakeProvider({ kind: "accepted" });
      const { res, body, logs } = await call(jsonRequest({ email: address }), { provider });
      expect(res.status).toBe(400);
      expect(body).toEqual({ status: "invalid" });
      expect(provider.calls).toHaveLength(0);
      expect(logs[0]).toMatchObject({ outcome: "invalid_email", reason: "format" });
    },
  );

  it("missing email field → 400 invalid (reason missing)", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const { res, body, logs } = await call(jsonRequest({ source: "hero" }), { provider });
    expect(res.status).toBe(400);
    expect(body).toEqual({ status: "invalid" });
    expect(logs[0]?.reason).toBe("missing");
    expect(provider.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe("request handling", () => {
  it("malformed JSON → 400 invalid", async () => {
    const { res, body, logs } = await call(jsonRequest("{ email: nope"), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(res.status).toBe(400);
    expect(body).toEqual({ status: "invalid" });
    expect(logs[0]?.outcome).toBe("malformed_body");
  });

  it("JSON that is not an object → 400 invalid", async () => {
    for (const raw of ["[]", "null", '"person@example.com"']) {
      const { res } = await call(jsonRequest(raw), { provider: fakeProvider({ kind: "accepted" }) });
      expect(res.status).toBe(400);
    }
  });

  it("oversized body (declared length) → 413 invalid", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const big = JSON.stringify({ email: EMAIL, pad: "x".repeat(MAX_BODY_BYTES) });
    const { res, body } = await call(jsonRequest(big), { provider });
    expect(res.status).toBe(413);
    expect(body).toEqual({ status: "invalid" });
    expect(provider.calls).toHaveLength(0);
  });

  it("oversized streamed body without Content-Length → 413 invalid", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 4) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const init = {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit;
    const request = new Request(ENDPOINT, init);
    expect(request.headers.get("content-length")).toBeNull();
    const { res, body } = await call(request, { provider: fakeProvider({ kind: "accepted" }) });
    expect(res.status).toBe(413);
    expect(body).toEqual({ status: "invalid" });
  });

  it("a body of exactly 2 KB is allowed", async () => {
    const base = JSON.stringify({ email: EMAIL, pad: "" });
    const exact = JSON.stringify({ email: EMAIL, pad: "x".repeat(MAX_BODY_BYTES - base.length) });
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_BODY_BYTES);
    const { res } = await call(jsonRequest(exact), { provider: fakeProvider({ kind: "accepted" }) });
    expect(res.status).toBe(200);
  });

  it("unsupported or missing content type → 400 invalid", async () => {
    const plain = new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "text/plain", accept: "application/json" },
      body: `email=${EMAIL}`,
    });
    const r1 = await call(plain, { provider: fakeProvider({ kind: "accepted" }) });
    expect(r1.res.status).toBe(400);
    expect(r1.body).toEqual({ status: "invalid" });
    expect(r1.logs[0]?.outcome).toBe("unsupported_content_type");

    const none = new Request(ENDPOINT, { method: "POST", body: new Uint8Array([1, 2, 3]) });
    const r2 = await call(none, { provider: fakeProvider({ kind: "accepted" }) });
    expect(r2.res.status).toBe(400);
  });

  it("GET → 405 with Allow: POST", async () => {
    const { res, body, logs } = await call(new Request(ENDPOINT, { method: "GET" }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(body).toEqual({ status: "invalid" });
    expect(logs[0]?.outcome).toBe("method_not_allowed");
  });

  it("cross-origin Origin → 403 forbidden without calling the provider", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const { res, body } = await call(
      jsonRequest({ email: EMAIL }, { headers: { origin: "https://evil.example" } }),
      { provider },
    );
    expect(res.status).toBe(403);
    expect(body).toEqual({ status: "forbidden" });
    expect(provider.calls).toHaveLength(0);
  });

  it('opaque Origin "null" → 403 forbidden', async () => {
    const { res } = await call(jsonRequest({ email: EMAIL }, { headers: { origin: "null" } }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(res.status).toBe(403);
  });

  it("same-origin Origin (or no Origin) is allowed", async () => {
    const same = await call(jsonRequest({ email: EMAIL }, { headers: { origin: SITE } }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(same.res.status).toBe(200);
    // Host comparison ignores scheme (TLS-terminating proxies).
    const http = await call(jsonRequest({ email: EMAIL }, { headers: { origin: "http://covalent.test" } }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(http.res.status).toBe(200);
    const none = await call(jsonRequest({ email: EMAIL }), { provider: fakeProvider({ kind: "accepted" }) });
    expect(none.res.status).toBe(200);
  });

  it("trusts Sec-Fetch-Site: same-origin even when the URL host is the adapter's localhost fallback", async () => {
    // Astro's node adapter builds request.url as http://localhost:<port>/... unless
    // security.allowedDomains is configured, while the browser's Origin is the public host.
    const request = new Request("http://localhost:4321/api/waitlist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: "https://covalent.example",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ email: EMAIL }),
    });
    const { res } = await call(request, { provider: fakeProvider({ kind: "accepted" }) });
    expect(res.status).toBe(200);
  });

  it.each(["cross-site", "same-site"])(
    "Sec-Fetch-Site: %s → 403 forbidden even without an Origin header",
    async (site) => {
      const provider = fakeProvider({ kind: "accepted" });
      const { res, body } = await call(
        jsonRequest({ email: EMAIL }, { headers: { "sec-fetch-site": site } }),
        { provider },
      );
      expect(res.status).toBe(403);
      expect(body).toEqual({ status: "forbidden" });
      expect(provider.calls).toHaveLength(0);
    },
  );

  it("accepts multipart/form-data with Accept: application/json as JSON", async () => {
    const form = new FormData();
    form.set("email", EMAIL);
    form.set("source", "final");
    const provider = fakeProvider({ kind: "accepted" });
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json" },
      body: form,
    });
    const { res, body } = await call(request, { provider });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "accepted" });
    expect(provider.calls[0]).toMatchObject({ email: EMAIL, source: "final" });
  });

  it("unknown source values fall back to hero for JS requests", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const { logs } = await call(jsonRequest({ email: EMAIL, source: "<script>" }), { provider });
    expect(provider.calls[0]?.source).toBe("hero");
    expect(logs[0]?.source).toBe("hero");
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("rate limiting", () => {
  it("returns 429 with Retry-After after N attempts and does not call the provider", async () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const provider = fakeProvider({ kind: "accepted" });
    const ctx = { provider, limiter, clientAddress: "203.0.113.7" };
    for (let i = 0; i < 3; i += 1) {
      const { res } = await call(jsonRequest({ email: EMAIL }), ctx);
      expect(res.status).toBe(200);
    }
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), ctx);
    expect(res.status).toBe(429);
    expect(body).toEqual({ status: "rate_limited" });
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(provider.calls).toHaveLength(3);
    expect(logs[0]?.outcome).toBe("rate_limited_local");

    // A different client is unaffected.
    const other = await call(jsonRequest({ email: EMAIL }), { ...ctx, clientAddress: "198.51.100.1" });
    expect(other.res.status).toBe(200);
  });

  it("ignores X-Forwarded-For by default: rotating it cannot escape the client's bucket", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const provider = fakeProvider({ kind: "accepted" });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { res } = await call(
        jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": `10.0.0.${i}, 198.51.100.${i}` } }),
        { provider, limiter, clientAddress: "203.0.113.9" },
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(provider.calls).toHaveLength(2);
  });

  it("ignores X-Forwarded-For by default: forging a victim's address cannot lock the victim out", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const provider = fakeProvider({ kind: "accepted" });
    const victim = "192.0.2.50";
    for (let i = 0; i < 3; i += 1) {
      await call(jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": victim } }), {
        provider,
        limiter,
        clientAddress: "203.0.113.66",
      });
    }
    const own = await call(jsonRequest({ email: EMAIL }), { provider, limiter, clientAddress: victim });
    expect(own.res.status).toBe(200);
  });

  it("never falls back to X-Forwarded-For when the adapter gives no client address", async () => {
    const hit = vi.fn(() => ({ allowed: false as const, retryAfterSeconds: 60 }));
    const provider = fakeProvider({ kind: "accepted" });
    const { res } = await call(
      jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": "192.0.2.10, 10.0.0.1" } }),
      { provider, limiter: { hit } },
    );
    // No trustworthy key, so the local limiter is skipped rather than keyed on a forgeable header.
    expect(hit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("WAITLIST_TRUSTED_PROXY_HOPS=1 keys on the right-most entry, not the forgeable left ones", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const provider = fakeProvider({ kind: "accepted" });
    const env = { WAITLIST_TRUSTED_PROXY_HOPS: "1" };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      // Astro (with security.allowedDomains) would report the left-most, forged entry.
      const { res } = await call(
        jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` } }),
        { env, provider, limiter, clientAddress: `10.0.0.${i}` },
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);

    // The forged victim address on the left never counted against the victim.
    const victim = await call(
      jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": "10.0.0.1" } }),
      { env, provider, limiter, clientAddress: "10.0.0.1" },
    );
    expect(victim.res.status).toBe(200);
  });

  it("WAITLIST_TRUSTED_PROXY_HOPS=2 keys on the second entry from the right", async () => {
    const hit = vi.fn((_key: string) => ({ allowed: true as const }));
    const provider = fakeProvider({ kind: "accepted" });
    await call(
      jsonRequest({ email: EMAIL }, { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.2" } }),
      { env: { WAITLIST_TRUSTED_PROXY_HOPS: "2" }, provider, limiter: { hit }, clientAddress: "10.0.0.3" },
    );
    expect(hit).toHaveBeenCalledWith("198.51.100.4");
  });

  it("rateLimitKey: falls back to the adapter address when the header is short or absent", () => {
    expect(rateLimitKey("203.0.113.1", "198.51.100.1", 0)).toBe("203.0.113.1");
    expect(rateLimitKey(undefined, "198.51.100.1", 0)).toBeUndefined();
    expect(rateLimitKey("  ", null, 0)).toBeUndefined();
    expect(rateLimitKey("203.0.113.1", "198.51.100.1", 2)).toBe("203.0.113.1");
    expect(rateLimitKey("203.0.113.1", null, 1)).toBe("203.0.113.1");
    expect(rateLimitKey("203.0.113.1", " , ,", 1)).toBe("203.0.113.1");
    expect(rateLimitKey(undefined, "x,, 198.51.100.7 ", 1)).toBe("198.51.100.7");
    expect(rateLimitKey(undefined, "a, b, c", 3)).toBe("a");
  });

  it("reads WAITLIST_TRUSTED_PROXY_HOPS with a safe default of 0", () => {
    expect(trustedProxyHopsFromEnv({})).toBe(0);
    expect(trustedProxyHopsFromEnv({ WAITLIST_TRUSTED_PROXY_HOPS: " 2 " })).toBe(2);
    expect(trustedProxyHopsFromEnv({ WAITLIST_TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    for (const bad of ["abc", "-1", "1.5", "", "1e3", "99999999999999999999"]) {
      expect(trustedProxyHopsFromEnv({ WAITLIST_TRUSTED_PROXY_HOPS: bad })).toBe(0);
    }
  });

  it("sliding window: allows again after the window and computes Retry-After", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });
    expect(limiter.hit("a")).toEqual({ allowed: true });
    now = 4_000;
    expect(limiter.hit("a")).toEqual({ allowed: true });
    now = 5_000;
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 5 });
    now = 10_001;
    expect(limiter.hit("a")).toEqual({ allowed: true });
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 4 });
  });

  it("bounds memory by evicting the least recently used address", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
    limiter.hit("b");
    limiter.hit("c"); // evicts "a"
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("reads WAITLIST_RATE_LIMIT / WAITLIST_RATE_WINDOW_SECONDS with safe defaults", () => {
    expect(rateLimiterOptionsFromEnv({})).toEqual({ limit: 20, windowMs: 600_000 });
    expect(
      rateLimiterOptionsFromEnv({ WAITLIST_RATE_LIMIT: "3", WAITLIST_RATE_WINDOW_SECONDS: " 60 " }),
    ).toEqual({ limit: 3, windowMs: 60_000 });
    for (const bad of ["abc", "-1", "0", "1.5", ""]) {
      expect(
        rateLimiterOptionsFromEnv({ WAITLIST_RATE_LIMIT: bad, WAITLIST_RATE_WINDOW_SECONDS: bad }),
      ).toEqual({ limit: 20, windowMs: 600_000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe("provider selection", () => {
  it("no env → unconfigured → 503 unavailable", async () => {
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), { env: {}, dev: true });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(logs[0]).toMatchObject({
      provider: UNCONFIGURED_PROVIDER_ID,
      outcome: "provider_unavailable",
      reason: "WAITLIST_PROVIDER is not set",
    });
    expect(res.headers.get("x-waitlist-destination")).toBeNull();
  });

  it("refuses the test provider outside development without WAITLIST_ALLOW_TEST_PROVIDER", async () => {
    const { res, body, logs } = await call(jsonRequest({ email: EMAIL }), {
      env: { WAITLIST_PROVIDER: "test" },
      dev: false,
    });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(logs[0]).toMatchObject({
      provider: UNCONFIGURED_PROVIDER_ID,
      reason: "test provider refused outside development",
    });
    expect(res.headers.get("x-waitlist-destination")).toBeNull();

    const notOne = selectProvider({ WAITLIST_PROVIDER: "test", WAITLIST_ALLOW_TEST_PROVIDER: "true" }, { dev: false });
    expect(notOne.id).toBe(UNCONFIGURED_PROVIDER_ID);
  });

  it("allows the test provider in dev or with WAITLIST_ALLOW_TEST_PROVIDER=1, and labels it", async () => {
    expect(selectProvider({ WAITLIST_PROVIDER: "test" }, { dev: true }).id).toBe(TEST_DESTINATION_ID);
    const { res, body } = await call(jsonRequest({ email: EMAIL }), {
      env: { WAITLIST_PROVIDER: "test", WAITLIST_ALLOW_TEST_PROVIDER: "1" },
      dev: false,
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "accepted" });
    expect(res.headers.get("x-waitlist-destination")).toBe(TEST_DESTINATION_ID);
  });

  it("unknown WAITLIST_PROVIDER → unconfigured with a clear reason", async () => {
    const { res, logs } = await call(jsonRequest({ email: EMAIL }), {
      env: { WAITLIST_PROVIDER: "mailchimpish" },
      dev: true,
    });
    expect(res.status).toBe(503);
    expect(logs[0]?.reason).toBe("unknown WAITLIST_PROVIDER");
  });

  it("does not resolve prototype keys as providers", () => {
    expect(selectProvider({ WAITLIST_PROVIDER: "constructor" }, { dev: true }).id).toBe(
      UNCONFIGURED_PROVIDER_ID,
    );
    expect(selectProvider({ WAITLIST_PROVIDER: "__proto__" }, { dev: true }).id).toBe(
      UNCONFIGURED_PROVIDER_ID,
    );
  });

  it("reads WAITLIST_TEST_CONFIRMATION for the test destination", () => {
    expect(selectProvider({ WAITLIST_PROVIDER: "test" }, { dev: true }).confirmation).toBe("none");
    expect(
      selectProvider(
        { WAITLIST_PROVIDER: "test", WAITLIST_TEST_CONFIRMATION: "double-opt-in" },
        { dev: true },
      ).confirmation,
    ).toBe("double-opt-in");
  });
});

// ---------------------------------------------------------------------------
// Controlled test destination
// ---------------------------------------------------------------------------

describe("controlled test destination", () => {
  it.each([
    ["confirm@example.com", 200, "confirmation_required"],
    ["duplicate@example.com", 200, "accepted"],
    ["limit@example.com", 429, "rate_limited"],
    ["fail@example.com", 503, "unavailable"],
    ["reject@example.com", 400, "invalid"],
    ["Confirm.Me+x@example.com", 200, "confirmation_required"],
  ] as const)("%s → %i %s", async (address, http, status) => {
    const { res, body } = await call(jsonRequest({ email: address }), {
      provider: createTestDestination(),
    });
    expect(res.status).toBe(http);
    expect(body).toEqual({ status });
    expect(res.headers.get("x-waitlist-destination")).toBe(TEST_DESTINATION_ID);
    if (status === "rate_limited") expect(res.headers.get("retry-after")).toBe("30");
  });

  it("remembers new addresses in memory: first accepted, repeat duplicate (still accepted publicly)", async () => {
    const provider = createTestDestination();
    expect(await provider.subscribe({ email: "new@example.com", source: "hero" })).toEqual({
      kind: "accepted",
    });
    expect(await provider.subscribe({ email: "new@example.com", source: "final" })).toEqual({
      kind: "duplicate",
    });
    const first = await call(jsonRequest({ email: "other@example.com" }), { provider });
    const repeat = await call(jsonRequest({ email: "other@example.com" }), { provider });
    expect(first.body).toEqual({ status: "accepted" });
    expect(repeat.body).toEqual(first.body);
    expect(repeat.res.status).toBe(first.res.status);
    expect(repeat.logs[0]?.outcome).toBe("duplicate");
  });

  it("double opt-in mode: new and repeat signups both read confirmation_required", async () => {
    const provider = createTestDestination({ confirmation: "double-opt-in" });
    const first = await call(jsonRequest({ email: "doi@example.com" }), { provider });
    const repeat = await call(jsonRequest({ email: "doi@example.com" }), { provider });
    expect(first.body).toEqual({ status: "confirmation_required" });
    expect(repeat.body).toEqual({ status: "confirmation_required" });
    expect(repeat.logs[0]?.outcome).toBe("duplicate");
  });

  it("slow… waits 2500 ms then accepts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const provider = createTestDestination();
    let result: ProviderOutcome | undefined;
    const pending = provider.subscribe({ email: "slow@example.com", source: "hero" }).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(2499);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result).toEqual({ kind: "accepted" });
  });

  it("slow… is cancelled by the handler timeout", async () => {
    const { res, logs } = await call(jsonRequest({ email: "slow@example.com" }), {
      provider: createTestDestination(),
      providerTimeoutMs: 20,
    });
    expect(res.status).toBe(503);
    expect(logs[0]?.outcome).toBe("provider_timeout");
  });
});

// ---------------------------------------------------------------------------
// No-JS fallback
// ---------------------------------------------------------------------------

describe("no-JS form posts", () => {
  it.each([
    [{ kind: "accepted" }, "/waitlist/joined/"],
    [{ kind: "duplicate" }, "/waitlist/joined/"],
    [{ kind: "confirmation_required" }, "/waitlist/confirm/"],
    [{ kind: "unavailable", reason: "x" }, "/waitlist/try-again/"],
    [{ kind: "rate_limited", retryAfterSeconds: 9 }, "/waitlist/try-again/"],
    [{ kind: "rejected" }, "/waitlist/try-again/"],
  ] as const)("%j → 303 %s", async (outcome, location) => {
    const { res, text } = await call(formRequest({ email: EMAIL, source: "no-js" }), {
      provider: fakeProvider(outcome),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(location);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(text).toBe("");
  });

  it("invalid email and cross-origin form posts redirect to try-again with nothing in the URL", async () => {
    const invalid = await call(formRequest({ email: "not an email" }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(invalid.res.status).toBe(303);
    expect(invalid.res.headers.get("location")).toBe("/waitlist/try-again/");

    const cross = await call(formRequest({ email: EMAIL }, { origin: "https://evil.example" }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(cross.res.status).toBe(303);
    expect(cross.res.headers.get("location")).toBe("/waitlist/try-again/");
  });

  it("double opt-in duplicate redirects to the confirm page", async () => {
    const { res } = await call(formRequest({ email: EMAIL }), {
      provider: fakeProvider({ kind: "duplicate" }, "double-opt-in"),
    });
    expect(res.headers.get("location")).toBe("/waitlist/confirm/");
  });

  it("form posts default the source to no-js", async () => {
    const provider = fakeProvider({ kind: "accepted" });
    const { logs } = await call(formRequest({ email: EMAIL }), { provider });
    expect(provider.calls[0]?.source).toBe("no-js");
    expect(logs[0]?.source).toBe("no-js");
  });

  it("multipart form posts without Accept: application/json also redirect", async () => {
    const form = new FormData();
    form.set("email", EMAIL);
    const request = new Request(ENDPOINT, { method: "POST", headers: { accept: "text/html" }, body: form });
    const { res } = await call(request, { provider: fakeProvider({ kind: "confirmation_required" }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/waitlist/confirm/");
  });

  it("form posts that ask for JSON get JSON, not a redirect", async () => {
    const { res, body } = await call(formRequest({ email: EMAIL }, { accept: "application/json" }), {
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "accepted" });
  });
});

// ---------------------------------------------------------------------------
// Privacy: logs and responses never contain the email (or the client address)
// ---------------------------------------------------------------------------

describe("privacy", () => {
  const SECRET = "Secret.Person+leak@Example.ORG";
  const SECRET_NORMALIZED = "Secret.Person+leak@example.org";
  const IP = "203.0.113.99";

  function assertNoLeak(result: CallResult): void {
    const haystacks = [
      result.text,
      JSON.stringify(result.logs),
      JSON.stringify([...result.res.headers.entries()]),
    ];
    for (const hay of haystacks) {
      for (const needle of [
        SECRET,
        SECRET_NORMALIZED,
        "secret.person",
        "leak@",
        "leak%40",
        IP,
      ]) {
        expect(hay.toLowerCase()).not.toContain(needle.toLowerCase());
      }
    }
  }

  it("emits exactly one structured log line per request with only allowed keys", async () => {
    const { logs } = await call(jsonRequest({ email: SECRET, source: "hero" }), {
      provider: fakeProvider({ kind: "accepted" }),
      clientAddress: IP,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      event: "waitlist",
      outcome: "accepted",
      provider: "fake",
      source: "hero",
      status: "accepted",
    });
  });

  it("never leaks the email or IP across every outcome", async () => {
    const limiter = createRateLimiter({ limit: 1000, windowMs: 60_000 });
    const scenarios: Array<[Request, Partial<WaitlistHandlerContext>]> = [
      [jsonRequest({ email: SECRET }), { provider: fakeProvider({ kind: "accepted" }) }],
      [jsonRequest({ email: SECRET }), { provider: fakeProvider({ kind: "duplicate" }, "double-opt-in") }],
      [jsonRequest({ email: SECRET }), { provider: fakeProvider({ kind: "rejected" }) }],
      [
        jsonRequest({ email: SECRET }),
        { provider: fakeProvider({ kind: "unavailable", reason: `upstream refused ${SECRET_NORMALIZED}` }) },
      ],
      [
        jsonRequest({ email: SECRET }),
        {
          provider: fakeProvider(async () => {
            throw new Error(`GET https://api.example/?e=Secret.Person%2Bleak%40example.org failed`);
          }),
        },
      ],
      [
        jsonRequest({ email: SECRET }),
        {
          provider: fakeProvider(async (input) => {
            throw new Error(`bad ${input.email.toUpperCase()} and ${input.email}`);
          }),
        },
      ],
      [jsonRequest({ email: "Secret.Person+leak@nodot" }), { provider: fakeProvider({ kind: "accepted" }) }],
      [formRequest({ email: SECRET }), { provider: fakeProvider({ kind: "accepted" }) }],
      [formRequest({ email: SECRET }), { provider: fakeProvider({ kind: "unavailable", reason: "x" }) }],
      [
        jsonRequest({ email: SECRET }, { headers: { origin: "https://evil.example" } }),
        { provider: fakeProvider({ kind: "accepted" }) },
      ],
      [jsonRequest({ email: SECRET }), { env: { WAITLIST_PROVIDER: "test" }, dev: true }],
      [jsonRequest({ email: SECRET }), { env: {} }],
    ];
    for (const [request, ctx] of scenarios) {
      const result = await call(request, {
        clientAddress: IP,
        limiter,
        ...ctx,
      });
      expect(result.logs).toHaveLength(1);
      assertNoLeak(result);
      expect(result.res.headers.get("location") ?? "").not.toMatch(/[?#]/);
    }
  });

  it("default logger writes one JSON line via console.info without the email", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await handleWaitlistRequest(jsonRequest({ email: SECRET }), {
      env: {},
      dev: false,
      provider: fakeProvider({ kind: "accepted" }),
    });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ event: "waitlist", outcome: "accepted", status: "accepted" });
    expect(line.toLowerCase()).not.toContain("leak");
  });

  it("a throwing logger does not change the response", async () => {
    const res = await handleWaitlistRequest(jsonRequest({ email: EMAIL }), {
      env: {},
      dev: false,
      provider: fakeProvider({ kind: "accepted" }),
      log: () => {
        throw new Error("log sink down");
      },
    });
    expect(res.status).toBe(200);
  });
});
