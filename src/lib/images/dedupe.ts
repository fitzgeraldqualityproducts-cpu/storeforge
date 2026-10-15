import { DUPLICATE_THRESHOLD, hammingDistance } from "./hash";

export interface HashedImage {
  id: string;
  phash: string;
  width: number;
  height: number;
  /** Lower wins ties (e.g. earlier position / uploads before scraped). */
  rank: number;
}

export interface DedupeResult {
  keep: string[];
  /** duplicate id → id of the kept image it duplicates */
  duplicates: Map<string, string>;
}

/**
 * Group images whose perceptual-hash Hamming distance is ≤ 6 and keep the highest-resolution member of
 * each group (ties broken by rank). Grouping is transitive (union-find).
 */
export function dedupe(images: HashedImage[], threshold = DUPLICATE_THRESHOLD): DedupeResult {
  const parent = images.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      if (hammingDistance(images[i]!.phash, images[j]!.phash) <= threshold) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, HashedImage[]>();
  images.forEach((img, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), img]);
  });
  const keep: string[] = [];
  const duplicates = new Map<string, string>();
  for (const members of groups.values()) {
    const best = [...members].sort(
      (a, b) => b.width * b.height - a.width * a.height || a.rank - b.rank,
    )[0]!;
    keep.push(best.id);
    for (const m of members) if (m.id !== best.id) duplicates.set(m.id, best.id);
  }
  return { keep, duplicates };
}
