/**
 * Server-side email normalization.
 *
 * Deliberately permissive: the goal is to catch obvious mistakes (no "@", no
 * domain dot, stray spaces) without rejecting real addresses such as
 * `o'brien+tag@sub.example.co.uk`, quoted local parts, or IDN/punycode domains.
 * Deliverability is the provider's job, not a regex's.
 */

export type NormalizeEmailResult =
  | { ok: true; email: string }
  | { ok: false; reason: "missing" | "format" | "length" };

/** RFC 5321 path limit for a whole address. */
const MAX_ADDRESS_LENGTH = 254;
/** RFC 5321 local-part limit. */
const MAX_LOCAL_LENGTH = 64;
/** Any whitespace (incl. Unicode spaces, line separators) or control character. */
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;

export function normalizeEmail(raw: unknown): NormalizeEmailResult {
  if (typeof raw !== "string") return { ok: false, reason: "missing" };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "missing" };
  if (trimmed.length > MAX_ADDRESS_LENGTH) return { ok: false, reason: "length" };
  if (WHITESPACE_OR_CONTROL.test(trimmed)) return { ok: false, reason: "format" };

  // Split on the LAST "@": quoted local parts may legally contain "@".
  const at = trimmed.lastIndexOf("@");
  if (at === -1) return { ok: false, reason: "format" };

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (local.length === 0) return { ok: false, reason: "format" };
  if (local.length > MAX_LOCAL_LENGTH) return { ok: false, reason: "length" };

  if (
    domain.length === 0 ||
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".")
  ) {
    return { ok: false, reason: "format" };
  }

  // The local part is case-sensitive in principle, so only the domain is lowercased.
  return { ok: true, email: `${local}@${domain.toLowerCase()}` };
}
