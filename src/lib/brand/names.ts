import { WATCHED_BRANDS } from "@/lib/guardrails";
import type { NameCandidate } from "@/lib/schemas";

export const PREFERRED_MAX_LENGTH = 14;

const VOWELS = /[aeiouy]/i;

/**
 * Deterministic syntactic checks: length, characters, and a pronounceability heuristic
 * (vowel ratio, consonant clusters, letter repeats). This is a quick screen, not a guarantee;
 * nothing here says whether a name or domain is free to use.
 */
export function checkName(
  name: string,
  opts: { avoid?: string[] } = {},
): NonNullable<NameCandidate["checks"]> {
  const notes: string[] = [];
  const trimmed = name.trim();
  const letters = trimmed.replace(/[^a-z]/gi, "");
  const length = trimmed.length;
  const hasDigitsOrSymbols = /[^a-z\s'&]/i.test(trimmed) || /\d/.test(trimmed);

  if (length > PREFERRED_MAX_LENGTH)
    notes.push(`${length} characters; ${PREFERRED_MAX_LENGTH} or fewer is easier to remember`);
  if (hasDigitsOrSymbols) notes.push("Contains digits, hyphens or symbols");
  if (trimmed.split(/\s+/).length > 2) notes.push("More than two words");

  const vowelCount = [...letters].filter((c) => VOWELS.test(c)).length;
  const vowelRatio = letters.length ? vowelCount / letters.length : 0;
  const longCluster = /[^aeiouy\s]{4,}/i.test(trimmed.replace(/[^a-z\s]/gi, ""));
  const tripleLetter = /([a-z])\1\1/i.test(letters);
  const pronounceable = letters.length >= 2 && vowelRatio >= 0.2 && !longCluster && !tripleLetter;
  if (!pronounceable) notes.push("May be hard to pronounce on first read");

  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  for (const brand of WATCHED_BRANDS) {
    const b = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (b.length >= 3 && compact.includes(b)) notes.push(`Contains the brand name "${brand}"`);
  }
  for (const other of opts.avoid ?? []) {
    const o = other.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (o.length >= 3 && (compact.includes(o) || o.includes(compact)))
      notes.push(`Too close to "${other}", a brand on the source page`);
  }
  return { length, pronounceable, hasDigitsOrSymbols, notes };
}

/** True when the checks found nothing that should rule the name out. */
export function nameIsUsable(checks: NonNullable<NameCandidate["checks"]>): boolean {
  return (
    !checks.hasDigitsOrSymbols &&
    checks.pronounceable &&
    !checks.notes.some((n) => n.startsWith("Contains the brand") || n.startsWith("Too close"))
  );
}

const TLD = /\.(com|co|shop|store|net|org|io|us|uk|co\.uk|ca|au|com\.au|de|fr|nl|eu)$/i;

/** A normalized "name.com"-style suggestion. Only a suggestion: availability is never checked. */
export function normalizeDomain(name: string, suggested?: string | null): string {
  const s = (suggested ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const m = s.match(TLD);
  if (m) {
    const label = s
      .slice(0, s.length - m[0].length)
      .replace(/^www\./, "")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "");
    if (label.length >= 2) return `${label}${m[0]}`;
  }
  const label = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `${label || "store"}.com`;
}

/**
 * A neutral lookup the merchant can use to check registration themselves (ICANN's RDAP
 * lookup). Labelled "check availability" in the UI; the app never claims availability.
 */
export function availabilityLookupUrl(domain: string): string {
  return `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`;
}

/** Fill in checks and a normalized domain for a candidate (AI output or merchant-typed). */
export function finalizeCandidate(
  c: { name: string; rationale: string; domainSuggestion?: string | null },
  opts: { avoid?: string[] } = {},
): NameCandidate {
  const name = c.name.trim().replace(/\s+/g, " ");
  return {
    name,
    rationale: c.rationale.trim(),
    checks: checkName(name, opts),
    domainSuggestion: normalizeDomain(name, c.domainSuggestion),
  };
}
