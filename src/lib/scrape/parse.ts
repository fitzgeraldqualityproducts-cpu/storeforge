import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type {
  ExtractedImage,
  ExtractedOption,
  ExtractedVariant,
  SourceExtraction,
} from "@/lib/schemas";

export const RAW_TEXT_LIMIT = 20_000;

export type ParsedPage = Omit<
  SourceExtraction,
  "url" | "fetchMethod" | "fetchedAt" | "warnings" | "adapter" | "finalUrl" | "sourceDomain"
>;

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "name" in v) return str((v as Json).name);
  if (v && typeof v === "object" && "@value" in v) return str((v as Json)["@value"]);
  return null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parsePriceText(v);
    return n;
  }
  return null;
};

/** Parse "1.299,00 €", "$1,299.00", "1299" into a number. */
export function parsePriceText(text: string): number | null {
  const m = text
    .replace(/\s/g, "")
    .match(/(\d{1,3}(?:[., ']\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1]!;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is decimal separator if followed by 1-2 digits at end
    s = /,\d{1,2}$/.test(s) ? s.replace(/[. ']/g, "").replace(",", ".") : s.replace(/,/g, "");
  } else {
    s = s.replace(/[, ']/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  A$: "AUD",
  C$: "CAD",
  CA$: "CAD",
  AU$: "AUD",
  "₩": "KRW",
  R$: "BRL",
  zł: "PLN",
  kr: "SEK",
  CHF: "CHF",
};

export function detectCurrency(text: string): string | null {
  const code = text.match(
    /\b(USD|EUR|GBP|CAD|AUD|JPY|CNY|INR|CHF|SEK|NOK|DKK|PLN|BRL|MXN|NZD|SGD|HKD|KRW)\b/,
  );
  if (code) return code[1]!;
  for (const [sym, c] of Object.entries(CURRENCY_SYMBOLS).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (text.includes(sym)) return c;
  }
  return null;
}

function flattenJsonLd(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => flattenJsonLd(n, out));
  else if (node && typeof node === "object") {
    const o = node as Json;
    out.push(o);
    if (o["@graph"]) flattenJsonLd(o["@graph"], out);
  }
  return out;
}

const hasType = (o: Json, t: string) =>
  asArray(o["@type"] as string | string[]).some((x) => String(x).toLowerCase() === t.toLowerCase());

export function extractJsonLd($: CheerioAPI): unknown[] {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some sites emit invalid JSON-LD (trailing commas, control chars). Try a light repair.
      try {
        blocks.push(
          JSON.parse(raw.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]+/g, " ")),
        );
      } catch {
        /* skip */
      }
    }
  });
  return blocks;
}

function imageUrlsFrom(v: unknown): string[] {
  return asArray(v as unknown[])
    .map((i) =>
      typeof i === "string"
        ? i
        : i && typeof i === "object"
          ? (str((i as Json).url) ?? str((i as Json).contentUrl))
          : null,
    )
    .filter((x): x is string => Boolean(x));
}

interface JsonLdProduct {
  title: string | null;
  description: string | null;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  price: { amount: number; currency: string } | null;
  availability: string | null;
  images: string[];
  rating: { value: number; count: number | null } | null;
  variants: ExtractedVariant[];
  options: ExtractedOption[];
  specs: Record<string, string>;
}

function offerPrice(
  offers: unknown,
): { amount: number; currency: string; availability: string | null } | null {
  for (const o of asArray(offers as Json[])) {
    if (!o || typeof o !== "object") continue;
    const amount =
      num(o.price) ?? num(o.lowPrice) ?? num((o.priceSpecification as Json | undefined)?.price);
    const currency =
      str(o.priceCurrency) ??
      str((o.priceSpecification as Json | undefined)?.priceCurrency) ??
      "USD";
    if (amount != null) {
      const availability = str(o.availability)?.replace(/^https?:\/\/schema\.org\//, "") ?? null;
      return { amount, currency, availability };
    }
    if (o.offers) {
      const nested = offerPrice(o.offers);
      if (nested) return nested;
    }
  }
  return null;
}

export function productFromJsonLd(blocks: unknown[]): JsonLdProduct | null {
  const nodes = flattenJsonLd(blocks);
  const product = nodes.find((n) => hasType(n, "Product")) ?? null;
  const group = nodes.find((n) => hasType(n, "ProductGroup")) ?? null;
  const main = product ?? group;
  if (!main) return null;
  const variantNodes = asArray((group?.hasVariant ?? main.hasVariant) as Json[]).filter(
    (v) => v && typeof v === "object",
  );
  const variesBy = asArray(group?.variesBy as string[]).map((v) =>
    String(v).replace(/^https?:\/\/schema\.org\//, ""),
  );
  const optionMap = new Map<string, Set<string>>();
  const variants: ExtractedVariant[] = variantNodes.map((v) => {
    const opts: string[] = [];
    for (const key of variesBy.length ? variesBy : ["color", "size", "material", "pattern"]) {
      const val = str(v[key]);
      if (val) {
        opts.push(val);
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        if (!optionMap.has(name)) optionMap.set(name, new Set());
        optionMap.get(name)!.add(val);
      }
    }
    const p = offerPrice(v.offers);
    return {
      title: str(v.name) ?? opts.join(" / "),
      options: opts,
      sku: str(v.sku),
      price: p?.amount ?? null,
      available: p?.availability ? /InStock/i.test(p.availability) : null,
      imageUrl: imageUrlsFrom(v.image)[0] ?? null,
    };
  });
  const price =
    offerPrice(main.offers) ?? (variantNodes.length ? offerPrice(variantNodes[0]!.offers) : null);
  const agg = (main.aggregateRating ?? null) as Json | null;
  const ratingValue = agg ? num(agg.ratingValue) : null;
  const specs: Record<string, string> = {};
  for (const p of asArray(main.additionalProperty as Json[])) {
    const k = str(p?.name);
    const v = str(p?.value);
    if (k && v) specs[k] = v;
  }
  for (const key of [
    "material",
    "color",
    "weight",
    "width",
    "height",
    "depth",
    "size",
    "pattern",
    "model",
  ]) {
    const v = str(main[key]);
    if (v && !specs[key]) specs[key.charAt(0).toUpperCase() + key.slice(1)] = v;
  }
  const images = [
    ...imageUrlsFrom(main.image),
    ...variantNodes.flatMap((v) => imageUrlsFrom(v.image)),
  ];
  return {
    title: str(main.name),
    description: str(main.description),
    brand: str(main.brand),
    sku: str(main.sku) ?? str(main.mpn),
    gtin:
      str(main.gtin13) ?? str(main.gtin12) ?? str(main.gtin14) ?? str(main.gtin8) ?? str(main.gtin),
    price: price ? { amount: price.amount, currency: price.currency } : null,
    availability: price?.availability ?? null,
    images,
    rating:
      ratingValue != null
        ? { value: ratingValue, count: num(agg!.reviewCount) ?? num(agg!.ratingCount) }
        : null,
    variants,
    options: [...optionMap.entries()].map(([name, values]) => ({ name, values: [...values] })),
    specs,
  };
}

function meta($: CheerioAPI, names: string[]): string | null {
  for (const n of names) {
    const v =
      $(`meta[property="${n}"]`).attr("content") ??
      $(`meta[name="${n}"]`).attr("content") ??
      $(`meta[itemprop="${n}"]`).attr("content");
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function microdata($: CheerioAPI) {
  const scope = $('[itemtype*="schema.org/Product"]').first();
  if (!scope.length) return null;
  const prop = (p: string) => {
    const el = scope.find(`[itemprop="${p}"]`).first();
    if (!el.length) return null;
    return (el.attr("content") ?? el.attr("src") ?? el.attr("href") ?? el.text()).trim() || null;
  };
  const images: string[] = [];
  scope.find('[itemprop="image"]').each((_, el) => {
    const v = $(el).attr("src") ?? $(el).attr("content") ?? $(el).attr("href");
    if (v) images.push(v);
  });
  const priceText = prop("price");
  return {
    title: prop("name"),
    description: prop("description"),
    brand: prop("brand"),
    sku: prop("sku"),
    price: priceText ? parsePriceText(priceText) : null,
    currency: prop("priceCurrency"),
    images,
  };
}

/** Visible text with scripts/styles/nav chrome removed, whitespace-collapsed. */
export function visibleText($: CheerioAPI): string {
  const clone = cheerio.load($.html());
  clone(
    "script, style, noscript, svg, iframe, template, head, nav, footer, header [role=navigation]",
  ).remove();
  return clone("body").text().replace(/\s+/g, " ").trim();
}

function specsFromDom($: CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};
  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 2 || rows.length > 60) return;
    rows.each((__, tr) => {
      const cells = $(tr).find("th, td");
      if (cells.length === 2) {
        const k = $(cells[0]).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
        const v = $(cells[1]).text().replace(/\s+/g, " ").trim();
        if (k && v && k.length < 60 && v.length < 300) specs[k] = v;
      }
    });
  });
  $("dl").each((_, dl) => {
    const dts = $(dl).find("dt");
    dts.each((__, dt) => {
      const k = $(dt).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
      const v = $(dt).next("dd").text().replace(/\s+/g, " ").trim();
      if (k && v && k.length < 60 && v.length < 300) specs[k] = v;
    });
  });
  return specs;
}

const OPTION_NAME_RE =
  /\b(size|colou?r|style|material|pattern|length|width|capacity|volume|pack|quantity|model|finish|flavou?r|scent)\b/i;

function optionsFromDom($: CheerioAPI): ExtractedOption[] {
  const out: ExtractedOption[] = [];
  $("select").each((_, sel) => {
    const id = $(sel).attr("id");
    const label =
      (id ? $(`label[for="${id}"]`).text() : "") ||
      $(sel).attr("aria-label") ||
      $(sel).attr("name") ||
      "";
    const m = label.match(OPTION_NAME_RE);
    if (!m) return;
    const values = $(sel)
      .find("option")
      .map((__, o) => $(o).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((v) => v && !/^(select|choose|pick)\b/i.test(v) && v !== "-");
    if (values.length) {
      const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      if (!out.some((o) => o.name === name))
        out.push({ name, values: [...new Set(values)].slice(0, 100) });
    }
  });
  // Swatch-style radio groups: <fieldset><legend>Color</legend><input value="Red">
  $("fieldset").each((_, fs) => {
    const legend = $(fs).find("legend").first().text();
    const m = legend.match(OPTION_NAME_RE);
    if (!m) return;
    const values = $(fs)
      .find("input[type=radio]")
      .map((__, i) => $(i).attr("value") ?? "")
      .get()
      .filter(Boolean);
    const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
    if (values.length && !out.some((o) => o.name === name))
      out.push({ name, values: [...new Set(values)] });
  });
  return out.slice(0, 3);
}

function priceFromDom($: CheerioAPI): { amount: number; currency: string | null } | null {
  const selectors = [
    "[itemprop=price]",
    "[data-price]",
    ".price .money",
    ".product-price",
    ".price",
    "[class*=price]",
    "[id*=price]",
  ];
  for (const s of selectors) {
    const el = $(s).first();
    if (!el.length) continue;
    const text = (el.attr("content") ?? el.attr("data-price") ?? el.text()).trim();
    if (!text || text.length > 60) continue;
    const amount = parsePriceText(text);
    if (amount != null && amount > 0) return { amount, currency: detectCurrency(text) };
  }
  return null;
}

/** Collect image candidates from every common source. Filtering/upgrading happens later. */
function imagesFromDom($: CheerioAPI): ExtractedImage[] {
  const out: ExtractedImage[] = [];
  const push = (
    url: string | undefined | null,
    source: ExtractedImage["source"],
    el?: cheerio.Cheerio<never>,
  ) => {
    if (!url) return;
    const u = url.trim();
    if (!u || u.startsWith("data:") || u.startsWith("blob:")) return;
    const w = el ? Number(el.attr("width")) || null : null;
    const h = el ? Number(el.attr("height")) || null : null;
    out.push({ url: u, alt: el?.attr("alt")?.trim() ?? "", width: w, height: h, source });
  };
  $("img, source").each((_, node) => {
    const el = $(node) as unknown as cheerio.Cheerio<never>;
    const srcset = el.attr("srcset") ?? el.attr("data-srcset");
    if (srcset) push(bestFromSrcset(srcset), "srcset", el);
    for (const attr of [
      "data-zoom-image",
      "data-large_image",
      "data-zoom",
      "data-src-large",
      "data-old-hires",
      "data-full",
      "data-original",
      "data-lazy-src",
      "data-src",
    ]) {
      const v = el.attr(attr);
      if (v) push(v, "lazy", el);
    }
    push(el.attr("src"), "img", el);
  });
  return out;
}

export function bestFromSrcset(srcset: string): string | null {
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const score = desc ? parseFloat(desc) * (desc.endsWith("x") ? 1000 : 1) : 1;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

function detectLanguage($: CheerioAPI, text: string): string | null {
  const lang = $("html").attr("lang") ?? meta($, ["og:locale", "language", "content-language"]);
  if (lang) return lang.slice(0, 2).toLowerCase();
  // Tiny stopword heuristic as a fallback.
  const sample = ` ${text.slice(0, 4000).toLowerCase()} `;
  const score = (words: string[]) =>
    words.reduce((n, w) => n + (sample.split(` ${w} `).length - 1), 0);
  const scores: [string, number][] = [
    ["en", score(["the", "and", "with", "for", "this"])],
    ["de", score(["und", "der", "die", "mit", "für"])],
    ["fr", score(["et", "les", "des", "avec", "pour"])],
    ["es", score(["y", "los", "las", "con", "para"])],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]![1] > 2 ? scores[0]![0] : null;
}

/** Parse an HTML document into a SourceExtraction draft. Priority: JSON-LD → microdata → OG → DOM. */
export function parseProductHtml(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd($);
  const ld = productFromJsonLd(jsonLd);
  const md = microdata($);
  const text = visibleText($);

  const ogTitle = meta($, ["og:title", "twitter:title"]);
  const ogDesc = meta($, ["og:description", "twitter:description", "description"]);
  const ogPriceAmount = meta($, ["product:price:amount", "og:price:amount"]);
  const ogPriceCurrency = meta($, ["product:price:currency", "og:price:currency"]);
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim() || null;
  const domPrice = priceFromDom($);

  const title = ld?.title ?? md?.title ?? ogTitle ?? h1 ?? ($("title").text().trim() || null);
  let price: ParsedPage["price"] = ld?.price ?? null;
  if (!price && md?.price != null) price = { amount: md.price, currency: md.currency ?? "USD" };
  if (!price && ogPriceAmount) {
    const a = parsePriceText(ogPriceAmount);
    if (a != null) price = { amount: a, currency: ogPriceCurrency ?? "USD" };
  }
  if (!price && domPrice)
    price = {
      amount: domPrice.amount,
      currency: domPrice.currency ?? detectCurrency(text) ?? "USD",
    };

  const images: ExtractedImage[] = [
    ...(ld?.images ?? []).map((url) => ({
      url,
      alt: "",
      width: null,
      height: null,
      source: "jsonld" as const,
    })),
    ...(md?.images ?? []).map((url) => ({
      url,
      alt: "",
      width: null,
      height: null,
      source: "microdata" as const,
    })),
    ...[meta($, ["og:image:secure_url", "og:image"])]
      .filter(Boolean)
      .map((url) => ({ url: url!, alt: "", width: null, height: null, source: "og" as const })),
    ...[meta($, ["twitter:image", "twitter:image:src"])]
      .filter(Boolean)
      .map((url) => ({
        url: url!,
        alt: "",
        width: null,
        height: null,
        source: "twitter" as const,
      })),
    ...imagesFromDom($),
  ].map((img) => ({ ...img, url: absolutize(img.url, pageUrl) }));

  const domOptions = optionsFromDom($);
  const options = ld?.options.length ? ld.options : domOptions;
  const specs = { ...specsFromDom($), ...(ld?.specs ?? {}) };
  const shippingMatch = text.match(
    /[^.]{0,80}\b(ships?|shipping|delivery|dispatch(?:ed)?)\b[^.]{0,120}\./i,
  );

  return {
    title,
    description: ld?.description ?? md?.description ?? ogDesc,
    price,
    brand: ld?.brand ?? md?.brand ?? meta($, ["product:brand", "og:brand"]),
    sku: ld?.sku ?? md?.sku ?? null,
    gtin: ld?.gtin ?? null,
    availability: ld?.availability ?? meta($, ["product:availability", "og:availability"]),
    options,
    variants: ld?.variants ?? [],
    specs,
    images,
    rating: ld?.rating ?? null,
    shippingInfo: shippingMatch ? shippingMatch[0].trim() : null,
    language: detectLanguage($, text),
    rawText: text.slice(0, RAW_TEXT_LIMIT),
    jsonLd: jsonLd.slice(0, 10),
  };
}

export function absolutize(url: string, base: string): string {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url, base).toString();
  } catch {
    return url;
  }
}

/** "Thin" means we should try the headless browser: missing title or price, or too little text. */
export function isThin(p: Pick<ParsedPage, "title" | "price" | "rawText">) {
  return !p.title || !p.price || p.rawText.length < 500;
}
