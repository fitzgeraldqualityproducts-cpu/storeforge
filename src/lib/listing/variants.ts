import { MAX_OPTIONS, MAX_VARIANTS, type ProductOption, type ProductVariant } from "@/lib/schemas";

export const DEFAULT_OPTION: ProductOption = { name: "Title", values: ["Default Title"] };

const skuPart = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6);

/** SKU prefix from brand + product, e.g. "Linden Coffee" + "Pour-Over Dripper" → "LC-DRIP". */
export function skuPrefix(brand: string, productType: string): string {
  const initials =
    brand
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 3) || "SF";
  const word =
    productType
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .pop() ?? "ITEM";
  return `${initials}-${skuPart(word).slice(0, 4) || "ITEM"}`;
}

export function skuFor(prefix: string, values: string[]): string {
  const parts = values.filter((v) => v !== "Default Title").map(skuPart);
  return [prefix, ...parts].filter(Boolean).join("-").slice(0, 255);
}

/** Normalize options: trim, drop empties/duplicates, max 3 options. */
export function cleanOptions(options: ProductOption[]): {
  options: ProductOption[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const seen = new Set<string>();
  let out = options
    .map((o) => ({
      name: o.name.trim(),
      values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((o) => {
      const k = o.name.toLowerCase();
      if (!o.name || !o.values.length || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (out.length > MAX_OPTIONS) {
    warnings.push(
      `Shopify allows ${MAX_OPTIONS} options per product; kept ${out
        .slice(0, MAX_OPTIONS)
        .map((o) => o.name)
        .join(", ")} and dropped ${out
        .slice(MAX_OPTIONS)
        .map((o) => o.name)
        .join(", ")}.`,
    );
    out = out.slice(0, MAX_OPTIONS);
  }
  if (!out.length) out = [DEFAULT_OPTION];
  return { options: out, warnings };
}

const keyOf = (values: (string | null | undefined)[]) =>
  values
    .filter((v): v is string => typeof v === "string" && v !== "")
    .map((v) => v.toLowerCase())
    .join(" / ");

export const variantValues = (v: ProductVariant) =>
  [v.option1, v.option2, v.option3].filter((x): x is string => typeof x === "string" && x !== "");

/**
 * Full variant matrix (cartesian product of option values), capped at Shopify's 2,048
 * variants. Existing variants with the same option values keep their edited fields.
 */
export function buildMatrix(
  rawOptions: ProductOption[],
  defaults: {
    price: number;
    skuPrefix: string;
    grams: number;
    costPerItem?: number | null;
    compareAtPrice?: number | null;
  },
  existing: ProductVariant[] = [],
): { options: ProductOption[]; variants: ProductVariant[]; warnings: string[] } {
  const { options, warnings } = cleanOptions(rawOptions);
  let combos: string[][] = [[]];
  for (const o of options) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  if (combos.length > MAX_VARIANTS) {
    warnings.push(
      `${combos.length} combinations exceed Shopify's ${MAX_VARIANTS}-variant limit; only the first ${MAX_VARIANTS} were kept.`,
    );
    combos = combos.slice(0, MAX_VARIANTS);
  }
  if (combos.length > 100) {
    warnings.push(
      `${combos.length} variants: double-check every combination is something you actually sell.`,
    );
  }
  const prior = new Map(existing.map((v) => [keyOf(variantValues(v)), v]));
  const variants = combos.map((values): ProductVariant => {
    const old = prior.get(keyOf(values));
    return {
      option1: values[0]!,
      option2: values[1] ?? null,
      option3: values[2] ?? null,
      sku: old?.sku ?? skuFor(defaults.skuPrefix, values),
      price: old?.price ?? defaults.price,
      compareAtPrice: old?.compareAtPrice ?? defaults.compareAtPrice ?? null,
      costPerItem: old?.costPerItem ?? defaults.costPerItem ?? null,
      grams: old?.grams ?? defaults.grams,
      inventoryQty: old?.inventoryQty ?? 0,
      barcode: old?.barcode ?? null,
      imageId: old?.imageId ?? null,
    };
  });
  return { options, variants, warnings };
}

/** Problems that would make the import fail or produce a broken product. */
export function validateVariants(options: ProductOption[], variants: ProductVariant[]): string[] {
  const errors: string[] = [];
  if (!options.length) errors.push("At least one option is required (use Title / Default Title).");
  if (options.length > MAX_OPTIONS) errors.push(`At most ${MAX_OPTIONS} options are allowed.`);
  if (!variants.length) errors.push("At least one variant is required.");
  if (variants.length > MAX_VARIANTS) errors.push(`At most ${MAX_VARIANTS} variants are allowed.`);
  const seen = new Set<string>();
  const skus = new Set<string>();
  variants.forEach((v, i) => {
    const values = variantValues(v);
    const label = values.join(" / ") || `#${i + 1}`;
    if (values.length !== options.length) {
      errors.push(`Variant ${label} needs ${options.length} option value(s).`);
    }
    values.forEach((val, j) => {
      const opt = options[j];
      if (opt && !opt.values.includes(val)) {
        errors.push(`Variant ${label}: "${val}" isn't a value of ${opt.name}.`);
      }
    });
    const k = keyOf(values);
    if (seen.has(k)) errors.push(`Variant ${label} appears more than once.`);
    seen.add(k);
    if (v.sku) {
      if (skus.has(v.sku)) errors.push(`SKU ${v.sku} is used by more than one variant.`);
      skus.add(v.sku);
    }
    if (!(v.price > 0)) errors.push(`Variant ${label} needs a price above 0.`);
    if (v.compareAtPrice != null && v.compareAtPrice <= v.price) {
      errors.push(`Variant ${label}: compare-at price must be higher than the price, or empty.`);
    }
  });
  const expected = options.reduce((n, o) => n * o.values.length, 1);
  if (variants.length && expected <= MAX_VARIANTS && seen.size < expected) {
    errors.push(
      `${expected - seen.size} option combination(s) have no variant. Rebuild the matrix or remove unused option values.`,
    );
  }
  return errors;
}

/** Parse a weight spec ("340 g", "0.75 lb", "12 oz", "1.2 kg") to grams. */
export function parseGrams(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text
    .replace(",", ".")
    .match(/(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|lbs?|pounds?|oz|ounces?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const grams = unit.startsWith("k")
    ? n * 1000
    : unit.startsWith("l") || unit.startsWith("p")
      ? n * 453.592
      : unit.startsWith("o")
        ? n * 28.3495
        : n;
  return Math.round(grams);
}
