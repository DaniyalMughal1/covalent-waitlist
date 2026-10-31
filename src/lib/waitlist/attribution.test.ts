import { describe, expect, it } from "vitest";
import { attributionFromUrl, campaignSource, referralCode } from "./attribution";

describe("campaign attribution", () => {
  it("reads campaign and referral identifiers without retaining URLs", () => {
    expect(attributionFromUrl(new URL("https://covalent.test/?utm_source=LinkedIn&ref=Launch-1&email=private@example.com")))
      .toEqual({ utm_source: "linkedin", referral_code: "Launch-1" });
  });
  it.each([null, {}, "https://x.com/path", "user@example.com", "<script>", "a".repeat(65)])("ignores invalid campaign values %j", (value) => {
    expect(campaignSource(value)).toBe("direct");
    expect(referralCode(value)).toBeNull();
  });
  it("defaults unattributed traffic to direct", () => {
    expect(attributionFromUrl(new URL("https://covalent.test/"))).toEqual({ utm_source: "direct", referral_code: null });
  });
});
