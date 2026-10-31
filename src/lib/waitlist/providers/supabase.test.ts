import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createSupabaseProvider } from "./supabase";
import { selectProvider } from "./index";
import type { SubscribeInput } from "../types";

// Deliberately invalid fixture key, never a real credential.
const secret = "sb_secret_test_fixture_not_a_real_key";
const env = { SUPABASE_URL: "https://project.example.test", SUPABASE_SECRET_KEY: secret };
const input: SubscribeInput = {
  email: " Person+tag@EXAMPLE.COM ", source: "hero", clientAddress: "203.0.113.10",
  acquisitionSource: "LinkedIn", referralCode: "launch-01",
};
const stub = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
afterEach(() => vi.unstubAllGlobals());

describe("Supabase provider", () => {
  it("registers the real adapter", () => {
    expect(selectProvider({ ...env, WAITLIST_PROVIDER: "supabase" }, { dev: false }).id).toBe("supabase");
  });
  it.each([
    {}, { ...env, SUPABASE_SECRET_KEY: "sb_publishable_not_a_secret" },
    { ...env, SUPABASE_URL: "http://project.example.test" },
    { ...env, SUPABASE_URL: "https://project.example.test/path" },
    { ...env, SUPABASE_URL: "https://project.example.test/?key=secret" },
  ])("refuses invalid configuration without sending a request (%j)", async (config) => {
    const fetchMock = stub("accepted");
    const provider = createSupabaseProvider(config);
    expect(provider.id).toBe("unconfigured");
    expect((await provider.subscribe(input)).kind).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses URLs with embedded credentials", () => {
    const url = new URL(env.SUPABASE_URL);
    url.username = "test";
    url.password = "test";
    expect(createSupabaseProvider({ ...env, SUPABASE_URL: url.href }).id).toBe("unconfigured");
  });
  it("sends canonical email, campaign, referral and only an HMAC of the trusted address", async () => {
    const fetchMock = stub("accepted");
    const signal = new AbortController().signal;
    expect(await createSupabaseProvider(env).subscribe({ ...input, signal })).toEqual({ kind: "accepted" });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://project.example.test/rest/v1/rpc/join_waitlist");
    expect(request).toMatchObject({ method: "POST", signal, redirect: "error", cache: "no-store" });
    expect(request.headers.apikey).toBe(secret);
    expect(request.headers.authorization).toBeUndefined();
    expect(JSON.parse(request.body)).toEqual({
      p_email: "person+tag@example.com", p_source: "linkedin", p_referral_code: "launch-01",
      p_client_hash: createHmac("sha256", secret).update("covalent-waitlist-rate-limit\0").update(input.clientAddress!).digest("hex"),
      p_limit: 20, p_window_seconds: 600,
    });
    expect(request.body).not.toContain(input.clientAddress);
    expect(String(url)).not.toContain("person");
  });
  it("replaces unsafe attribution and respects bounded configured limits", async () => {
    const fetchMock = stub("accepted");
    await createSupabaseProvider({ ...env, WAITLIST_RATE_LIMIT: "2", WAITLIST_RATE_WINDOW_SECONDS: "60" })
      .subscribe({ ...input, acquisitionSource: "person@example.com", referralCode: "<script>" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      p_source: "direct", p_referral_code: null, p_limit: 2, p_window_seconds: 60,
    });
  });
  it.each([undefined, "", "forged-header", "203.0.113.10, 203.0.113.11"])("fails closed without a trusted IP (%j)", async (clientAddress) => {
    const fetchMock = stub("accepted");
    expect((await createSupabaseProvider(env).subscribe({ ...input, clientAddress })).kind).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts IPv6 client addresses", async () => {
    stub("accepted");
    expect((await createSupabaseProvider(env).subscribe({ ...input, clientAddress: "2001:db8::1" })).kind).toBe("accepted");
  });
  it("does not send invalid email to the database", async () => {
    const fetchMock = stub("accepted");
    expect(await createSupabaseProvider(env).subscribe({ ...input, email: "invalid" })).toEqual({ kind: "rejected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ["accepted", "accepted"], ["duplicate", "duplicate"], ["invalid", "rejected"],
    ["rate_limited", "rate_limited"], [null, "unavailable"], [{ status: "accepted" }, "unavailable"],
  ])("maps RPC result %j to %s", async (result, kind) => {
    stub(result);
    expect((await createSupabaseProvider(env).subscribe(input)).kind).toBe(kind);
  });
  it.each([401, 403, 404, 500, 503])("never leaks upstream error bodies for HTTP %s", async (status) => {
    stub({ message: `private email: person@example.com key: ${secret}` }, status);
    expect(await createSupabaseProvider(env).subscribe(input)).toEqual({ kind: "unavailable", reason: `supabase: HTTP ${status}` });
  });
  it("maps upstream throttling to a bounded retry", async () => {
    stub({}, 429);
    expect(await createSupabaseProvider(env).subscribe(input)).toEqual({ kind: "rate_limited", retryAfterSeconds: 600 });
  });
  it("does not expose thrown credentials or malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(secret)));
    expect(await createSupabaseProvider(env).subscribe(input)).toEqual({ kind: "unavailable", reason: "supabase: request failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
    expect((await createSupabaseProvider(env).subscribe(input)).kind).toBe("unavailable");
  });
});
