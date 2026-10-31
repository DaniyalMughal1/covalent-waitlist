/** Only short campaign identifiers are stored, never full URLs or referrers. */
export function campaignSource(value: unknown): string {
  if (typeof value !== "string") return "direct";
  const source = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(source) ? source : "direct";
}

export function referralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(code) ? code : null;
}

export function attributionFromUrl(url: URL): { utm_source: string; referral_code: string | null } {
  return {
    utm_source: campaignSource(url.searchParams.get("utm_source")),
    referral_code: referralCode(url.searchParams.get("ref")),
  };
}
