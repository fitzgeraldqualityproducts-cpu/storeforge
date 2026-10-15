/** Shared text helpers for listing fields (isomorphic). */

/** Truncate at a word boundary so the result is at most `max` characters. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  const out = (at > max * 0.5 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:–—-]+$/, "");
  return out.length <= max ? out : out.slice(0, max);
}

/** Shopify-style handle: lowercase a–z0–9 with single hyphens, at most `max` characters. */
export function toHandle(text: string, max = 60): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "product";
  if (base.length <= max) return base;
  const cut = base.slice(0, max + 1);
  const at = cut.lastIndexOf("-");
  return (at > max * 0.5 ? cut.slice(0, at) : base.slice(0, max)).replace(/-+$/, "");
}

/** Text content of simple HTML (tags removed, entities for the common cases decoded). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h2|h3|tr|th|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

export const CONFIRM_RE = /\[CONFIRM:\s*([^\]]+)\]/g;

/** Every unresolved [CONFIRM: …] marker, in order, de-duplicated. */
export function confirmMarkers(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(CONFIRM_RE)) out.add(m[1]!.trim());
  return [...out];
}

/**
 * Wrap [CONFIRM: …] markers and [BRACKETED PLACEHOLDERS] in <mark> for previews. Only for HTML
 * that was already sanitized; placeholders contain no markup.
 */
export function highlightPlaceholders(html: string): string {
  return html.replace(
    /\[CONFIRM:[^\]<]*\]|\[[A-Z0-9][A-Z0-9 &'’()/.,+-]{0,60}\]/g,
    (m) => `<mark class="confirm-mark">${m}</mark>`,
  );
}
