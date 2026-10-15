import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config";
import { listAssets } from "@/lib/db/assets";
import { createProject, getProject, updateProject } from "@/lib/db/projects";
import { findViolationsDeep } from "@/lib/guardrails";
import { ingestImage } from "@/lib/images/ingest";
import type { JobContext } from "@/lib/jobs/runner";
import { COMPARE_AT_WARNING, charmRound, suggestPrice } from "@/lib/listing/pricing";
import {
  jaccard,
  overlapScore,
  sectionProse,
  shingles,
  splitSections,
} from "@/lib/listing/similarity";
import { confirmMarkers, toHandle, truncateAtWord } from "@/lib/listing/text";
import { buildMatrix, parseGrams, skuPrefix, validateVariants } from "@/lib/listing/variants";
import { parseProductHtml } from "@/lib/scrape/parse";
import { ProductListing, SourceExtraction } from "@/lib/schemas";

const fake = vi.hoisted(() => ({
  queue: [] as unknown[],
  requests: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/ai/client", () => ({
  anthropic: () => ({
    messages: {
      stream: (req: Record<string, unknown>) => {
        fake.requests.push(structuredClone(req));
        return {
          finalMessage: async () => {
            const next = fake.queue.shift();
            if (!next) throw new Error("no scripted response");
            return next;
          },
        };
      },
    },
  }),
}));

import { generateSeo } from "@/lib/ai/listing";
import { enforceOriginality, runListing, sourceShingles } from "@/lib/pipeline/listing";
import { runRegenerate } from "@/lib/pipeline/regenerate";

const ctxFor = (projectId: string, payload: Record<string, unknown> = {}): JobContext => ({
  jobId: "t",
  projectId,
  type: "listing",
  payload,
  progress: async () => undefined,
});

const pricing = {
  currency: "USD",
  unitCost: null,
  targetMarginPct: null,
  targetPrice: null,
  competitorPrice: null,
  compareAtEnabled: false,
  regularPrice: null,
};

describe("text helpers", () => {
  it("truncates at word boundaries and builds handles", () => {
    expect(truncateAtWord("Stoneware pour-over coffee dripper for slow mornings", 30)).toBe(
      "Stoneware pour-over coffee",
    );
    expect(truncateAtWord("short", 30)).toBe("short");
    expect(toHandle("Café Crème & Co. — Pour-Over!")).toBe("cafe-creme-and-co-pour-over");
    expect(toHandle("a ".repeat(80)).length).toBeLessThanOrEqual(60);
    expect(confirmMarkers("x [CONFIRM: weight] y [CONFIRM:  weight ] [CONFIRM: size]")).toEqual([
      "weight",
      "size",
    ]);
  });
});

describe("similarity", () => {
  const source = shingles(
    "Our stoneware dripper is wheel thrown in small batches and glazed by hand so every piece is slightly different. " +
      Array.from(
        { length: 60 },
        (_, i) =>
          `Paragraph ${i} covers shipping zone ${i * 7}, returns window ${i + 3} and studio note ${i * 11}.`,
      ).join(" "),
  );

  it("flags copied prose even against a long source (containment, not just Jaccard)", () => {
    const copied =
      "<p>Our stoneware dripper is wheel thrown in small batches and glazed by hand so every piece is slightly different.</p>";
    const a = shingles(sectionProse(copied));
    expect(jaccard(a, source)).toBeLessThan(0.2);
    expect(overlapScore(sectionProse(copied), source)).toBeGreaterThan(0.9);
    const original =
      "<p>Each cone is shaped on a potter's wheel, so no two look quite the same.</p>";
    expect(overlapScore(sectionProse(original), source)).toBe(0);
  });

  it("splits sections by heading and ignores spec tables", () => {
    const html =
      "<p>Intro</p><h3>Details</h3><table><tr><td>our stoneware dripper is wheel thrown in small batches</td></tr></table><h3>Care</h3><p>Rinse.</p>";
    const s = splitSections(html);
    expect(s.map((x) => x.key)).toEqual(["intro", "Details", "Care"]);
    expect(overlapScore(sectionProse(s[1]!.html), source)).toBe(0);
  });
});

describe("pricing assistant", () => {
  it("prices from cost and margin with the math shown", () => {
    const p = suggestPrice({ ...pricing, unitCost: 12, targetMarginPct: 60 });
    expect(p.suggestedPrice).toBe(30.99);
    expect(p.steps.join("\n")).toContain("$12.00 ÷ 0.4 = $30.00");
    expect(p.marginPct).toBeCloseTo(61.28, 1);
    expect(p.compareAtPrice).toBeNull();
    expect(charmRound(29.1)).toBe(29.99);
  });

  it("uses the merchant's target, warns below cost, and never invents a compare-at", () => {
    const t = suggestPrice({ ...pricing, unitCost: 40, targetPrice: 35, competitorPrice: 34 });
    expect(t.suggestedPrice).toBe(35);
    expect(t.warnings.join()).toMatch(/below your cost/);
    const m = suggestPrice({ ...pricing, competitorPrice: 34, competitorSource: "source page" });
    expect(m.suggestedPrice).toBe(34);
    expect(m.warnings.join()).toMatch(/unit cost/);
    const on = suggestPrice({ ...pricing, competitorPrice: 34, compareAtEnabled: true });
    expect(on.compareAtPrice).toBeNull();
    expect(on.warnings).toContain(COMPARE_AT_WARNING);
    const regular = suggestPrice({
      ...pricing,
      targetPrice: 30,
      compareAtEnabled: true,
      regularPrice: 40,
    });
    expect(regular.compareAtPrice).toBe(40);
    expect(regular.steps.join()).toMatch(/25% off/);
    expect(suggestPrice(pricing).suggestedPrice).toBe(0);
  });
});

describe("variant matrix", () => {
  const defaults = { price: 34, skuPrefix: skuPrefix("Linden Coffee", "Coffee Dripper"), grams: 0 };

  it("builds the full matrix with SKUs and keeps edits on rebuild", () => {
    expect(defaults.skuPrefix).toBe("LC-DRIP");
    const m = buildMatrix(
      [
        { name: "Color", values: ["Sand", "Sage"] },
        { name: "Size", values: ["1-2 cups", "2-4 cups"] },
      ],
      defaults,
    );
    expect(m.variants).toHaveLength(4);
    expect(m.variants[0]).toMatchObject({
      option1: "Sand",
      option2: "1-2 cups",
      sku: "LC-DRIP-SAND-12CUPS",
      price: 34,
    });
    expect(validateVariants(m.options, m.variants)).toEqual([]);
    const edited = m.variants.map((v, i) => (i === 0 ? { ...v, price: 39, inventoryQty: 5 } : v));
    const again = buildMatrix(
      [
        { name: "Color", values: ["Sand", "Sage", "Clay"] },
        { name: "Size", values: ["1-2 cups", "2-4 cups"] },
      ],
      defaults,
      edited,
    );
    expect(again.variants).toHaveLength(6);
    expect(again.variants[0]).toMatchObject({ price: 39, inventoryQty: 5 });
  });

  it("caps options and variants at Shopify's limits and validates", () => {
    const four = buildMatrix(
      ["A", "B", "C", "D"].map((n) => ({ name: n, values: ["x"] })),
      defaults,
    );
    expect(four.options).toHaveLength(3);
    expect(four.warnings.join()).toMatch(/3 options/);
    const big = buildMatrix(
      [
        { name: "A", values: Array.from({ length: 50 }, (_, i) => `a${i}`) },
        { name: "B", values: Array.from({ length: 50 }, (_, i) => `b${i}`) },
      ],
      defaults,
    );
    expect(big.variants).toHaveLength(2048);
    expect(big.warnings.join()).toMatch(/2048-variant limit/);
    const none = buildMatrix([], defaults);
    expect(none.options).toEqual([{ name: "Title", values: ["Default Title"] }]);
    expect(none.variants[0]!.sku).toBe("LC-DRIP");

    const opts = [{ name: "Color", values: ["Sand", "Sage"] }];
    const base = buildMatrix(opts, defaults).variants;
    const errs = validateVariants(opts, [
      base[0]!,
      { ...base[0]! },
      { ...base[0]!, option1: "Blue", sku: "X", compareAtPrice: 10 },
    ]);
    expect(errs.join("\n")).toMatch(/more than once/);
    expect(errs.join("\n")).toMatch(/"Blue" isn't a value/);
    expect(errs.join("\n")).toMatch(/compare-at price must be higher/);
    expect(errs.join("\n")).toMatch(/SKU LC-DRIP-SAND is used by more than one/);
  });

  it("parses weights", () => {
    expect(parseGrams("Weight: 340 g")).toBe(340);
    expect(parseGrams("0.75 lb")).toBe(340);
    expect(parseGrams("12 oz")).toBe(340);
    expect(parseGrams("1,2 kg")).toBe(1200);
    expect(parseGrams("heavy")).toBeNull();
  });
});

async function dripperProject(name: string) {
  const p = await createProject(name);
  const html = readFileSync(path.join(__dirname, "../fixtures/site/product.html"), "utf8");
  const parsed = parseProductHtml(html, "https://shop.example/product.html");
  await updateProject(p.id, {
    inputs: {
      urls: ["https://shop.example/product.html"],
      context: { ...(await getProject(p.id)).inputs.context, tone: "Cozy" },
    },
    extractions: [
      SourceExtraction.parse({
        ...parsed,
        url: "https://shop.example/product.html",
        sourceDomain: "shop.example",
        fetchMethod: "static",
        fetchedAt: new Date().toISOString(),
      }),
    ],
  });
  for (const n of [1, 2, 3]) {
    await ingestImage(
      p.id,
      readFileSync(path.join(__dirname, `../fixtures/site/images/dripper-${n}.jpg`)),
      { origin: "upload" },
    );
  }
  return p;
}

describe("listing step (fixture mode)", () => {
  it("generates a valid listing from the product facts", async () => {
    const p = await dripperProject("Listing");
    const res = await runListing(ctxFor(p.id));
    const project = await getProject(p.id);
    const l = ProductListing.parse(project.listing);
    const meta = project.listingMeta!;
    expect(l.vendor).toBe(project.brandKit!.selectedName);
    expect(l.title.toLowerCase()).not.toContain("kilnworks");
    expect(l.title.length).toBeLessThanOrEqual(70);
    expect(l.tags.length).toBeLessThanOrEqual(13);
    expect(l.seoTitle.length).toBeLessThanOrEqual(60);
    expect(l.seoDescription.length).toBeLessThanOrEqual(155);
    expect(l.handle).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(l.status).toBe("draft");
    // Source options: Color Sand/Sage/Clay × Size 1-2 cups/2-4 cups.
    expect(l.options.map((o) => o.name)).toEqual(["Color", "Size"]);
    expect(l.variants).toHaveLength(6);
    expect(validateVariants(l.options, l.variants)).toEqual([]);
    expect(l.variants.every((v) => v.price === 34 && v.compareAtPrice == null)).toBe(true);
    expect(meta.pricing?.competitorSource).toBe("price on the source page");
    expect(meta.compareAtEnabled).toBe(false);
    expect(l.descriptionHtml).not.toMatch(/<(script|img|div|span)/i);
    expect(meta.confirmMarkers.length).toBeGreaterThan(0);
    expect(meta.guardrailViolations).toEqual([]);
    expect(findViolationsDeep(l)).toEqual([]);
    expect(meta.similarity.every((f) => f.finalScore <= 0.2)).toBe(true);
    expect(project.steps.listing.status).toBe("ready");
    expect(res.variants).toBe(6);
    const assets = await listAssets(p.id);
    expect(assets.every((a) => a.altText.length > 0 && a.altText.length <= 125)).toBe(true);
  });

  it("shortens a field and keeps placeholders", async () => {
    const p = await dripperProject("Shorten");
    await runListing(ctxFor(p.id));
    const before = (await getProject(p.id)).listing!;
    await runRegenerate(
      ctxFor(p.id, { section: "listing_field", field: "descriptionHtml", operation: "shorten" }),
    );
    const after = (await getProject(p.id)).listing!;
    expect(after.descriptionHtml.length).toBeLessThan(before.descriptionHtml.length);
    expect(confirmMarkers(after.descriptionHtml)).toEqual(
      expect.arrayContaining(confirmMarkers(before.descriptionHtml).slice(0, 1)),
    );
  });

  it("recomputes placeholders when the merchant edits the listing", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const p = await dripperProject("Edit listing");
    await runListing(ctxFor(p.id));
    const l = (await getProject(p.id)).listing!;
    const res = await PATCH(
      new Request(`http://localhost/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing: {
            ...l,
            descriptionHtml: "<p>Hand-thrown stoneware.<script>x()</script></p><p>Only 2 left!</p>",
          },
        }),
      }),
      { params: Promise.resolve({ id: p.id }) },
    );
    expect(res.status).toBe(200);
    const after = await getProject(p.id);
    expect(after.listing!.descriptionHtml).not.toContain("<script");
    expect(after.listingMeta!.confirmMarkers).toEqual([]);
    expect(after.listingMeta!.guardrailViolations.join()).toMatch(/only 2 left/i);
  });
});

describe("originality and SEO (live path with a scripted client)", () => {
  const tool = (name: string, input: unknown) => ({
    role: "assistant",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "tool_use", id: `tu_${Math.random()}`, name, input }],
  });
  beforeEach(() => {
    process.env.AI_MODE = "live";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    resetEnvCache();
    fake.queue.length = 0;
    fake.requests.length = 0;
  });
  afterEach(() => {
    process.env.AI_MODE = "fixture";
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvCache();
  });

  it("auto-regenerates sections that copy the source", async () => {
    const p = await dripperProject("Originality");
    const project = await getProject(p.id);
    const sourceText = project.extractions[0]!.description!;
    const copied = `<p>${sourceText}</p><h3>Care &amp; use</h3><p>Rinse with warm water after each use.</p>`;
    fake.queue.push(
      // First rewrite still copies → fed back; second is original.
      tool("record_rewrite", { value: `<p>${sourceText}</p>` }),
      tool("record_rewrite", {
        value:
          "<p>Shaped on a wheel and glazed by hand, this cone brings a slower ritual to your morning cup.</p>",
      }),
    );
    const { html, findings } = await enforceOriginality(project, copied, sourceShingles(project));
    expect(fake.requests).toHaveLength(2);
    expect(JSON.stringify(fake.requests[1]!.messages)).toMatch(/overlap with the source/);
    const intro = findings.find((f) => f.section === "intro")!;
    expect(intro.score).toBeGreaterThan(0.2);
    expect(intro.regenerated).toBe(true);
    expect(intro.finalScore).toBeLessThanOrEqual(0.2);
    expect(findings.find((f) => f.section === "Care & use")!.regenerated).toBe(false);
    expect(html).toContain("slower ritual");
    expect(html).toContain("<h3>Care &amp; use</h3>");
  });

  it("enforces SEO lengths in code", async () => {
    const p = await createProject("SEO");
    fake.queue.push(
      tool("record_seo", {
        seoTitle:
          "Stoneware Pour-Over Coffee Dripper for Slow Mornings and Better Coffee Every Day",
        seoDescription: `${"A hand-glazed stoneware pour-over cone that fits standard filters and brews a clean, balanced cup ".repeat(2)}`,
        handle: "Stoneware Pour Over -- Dripper!!",
        altTexts: [],
      }),
    );
    const seo = await generateSeo(
      await getProject(p.id),
      { title: "t", seoTitle: "s", seoDescription: "d", handle: "h", descriptionHtml: "<p>x</p>" },
      [],
    );
    expect(seo.seoTitle.length).toBeLessThanOrEqual(60);
    expect(seo.seoTitle).toBe("Stoneware Pour-Over Coffee Dripper for Slow Mornings and");
    expect(seo.seoDescription.length).toBeLessThanOrEqual(155);
    expect(seo.seoDescription.endsWith(" ")).toBe(false);
    expect(seo.handle).toBe("stoneware-pour-over-dripper");
  });
});
