import { htmlToText } from "./text";

/** Overlap above this fraction marks a section as too close to the source. */
export const SIMILARITY_THRESHOLD = 0.2;
export const SHINGLE_SIZE = 5;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function shingles(text: string, n = SHINGLE_SIZE): Set<string> {
  const t = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(" "));
  return out;
}

/** Classic Jaccard similarity of two shingle sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Share of a section's 5-grams that also appear in the source. Plain Jaccard against a long
 * source page dilutes copying (a fully copied paragraph scores near 0 against a 3,000-word
 * page), so the score is the larger of containment and Jaccard: it flags a section when more
 * than 20% of its 5-word runs were lifted from the source.
 */
export function overlapScore(section: string, source: Set<string>): number {
  const a = shingles(section);
  if (!a.size) return 0;
  let inter = 0;
  for (const s of a) if (source.has(s)) inter++;
  return Math.max(inter / a.size, jaccard(a, source));
}

/** The copied 5-grams, to tell the rewriter exactly what to avoid. */
export function sharedPhrases(section: string, source: Set<string>, limit = 12): string[] {
  return [...shingles(section)].filter((s) => source.has(s)).slice(0, limit);
}

export interface DescriptionSection {
  /** "intro" for content before the first heading, otherwise the heading text. */
  key: string;
  html: string;
}

/** Split description HTML into sections at <h2>/<h3> headings (heading kept with its body). */
export function splitSections(html: string): DescriptionSection[] {
  const parts = html.split(/(?=<h[23][\s>])/i);
  return parts
    .map((part, i) => {
      const m = part.match(/^<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      const key = m ? htmlToText(m[1]!).trim() || `section-${i}` : "intro";
      return { key, html: part };
    })
    .filter((s) => s.html.trim());
}

export function joinSections(sections: DescriptionSection[]): string {
  return sections.map((s) => s.html.trim()).join("\n");
}

/**
 * Prose of a section for comparison. Tables are excluded: a spec table restates facts
 * (material, capacity) that legitimately match the source.
 */
export function sectionProse(html: string): string {
  return htmlToText(html.replace(/<table[\s\S]*?<\/table>/gi, " "));
}
