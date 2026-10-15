import "server-only";
import { generateListing, generateSeo } from "@/lib/ai/listing";
import { rewriteField } from "@/lib/ai/rewrite";
import { fixtureListing } from "@/lib/ai/fixtures/listing";
import { prisma } from "@/lib/db/client";
import { orderedActiveAssets } from "@/lib/db/assets";
import { getProject, updateProject, type ProjectRecord } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import type { JobContext } from "@/lib/jobs/runner";
import { refreshListingMeta } from "@/lib/listing/meta";
import { suggestPrice } from "@/lib/listing/pricing";
import {
  joinSections,
  overlapScore,
  sectionProse,
  shingles,
  sharedPhrases,
  SIMILARITY_THRESHOLD,
  splitSections,
} from "@/lib/listing/similarity";
import { buildMatrix, parseGrams, skuPrefix } from "@/lib/listing/variants";
import {
  ListingMeta,
  ProductListing,
  type PricingSuggestion,
  type SimilarityFinding,
} from "@/lib/schemas";
import { runAnalyze } from "./analyze";
import { runBrand } from "./brand";

type Range = [number, number];
const span =
  (range: Range = [0, 100]) =>
  (f: number) =>
    range[0] + (range[1] - range[0]) * f;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Market reference price: median of reference-store prices, else the source page's price. */
export function marketPrice(project: ProjectRecord): { price: number; source: string } | null {
  const currency = project.inputs.context.currency;
  const same = (i: number) => {
    const p = project.extractions[i]?.price;
    return p && p.currency.toUpperCase() === currency && p.amount > 0 ? p.amount : null;
  };
  const refs = project.extractions
    .map((_, i) => (i === 0 ? null : same(i)))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  if (refs.length) {
    const mid = Math.floor(refs.length / 2);
    const median = refs.length % 2 ? refs[mid]! : (refs[mid - 1]! + refs[mid]!) / 2;
    return {
      price: round2(median),
      source: `median of ${refs.length} reference store${refs.length === 1 ? "" : "s"}`,
    };
  }
  const primary = same(0);
  return primary != null ? { price: primary, source: "price on the source page" } : null;
}

/** Pricing from the merchant's inputs (edited values in the listing step win over Step 1). */
export function pricingFor(project: ProjectRecord): PricingSuggestion {
  const c = project.inputs.context;
  const meta = project.listingMeta;
  const prev = meta?.pricing;
  const market = marketPrice(project);
  return suggestPrice({
    currency: c.currency,
    unitCost: prev ? prev.unitCost : c.unitCost,
    targetMarginPct: prev ? prev.targetMarginPct : c.targetMarginPct,
    targetPrice: prev ? prev.targetPrice : c.targetPrice,
    competitorPrice: prev?.competitorPrice ?? market?.price ?? null,
    competitorSource:
      prev?.competitorPrice != null ? prev.competitorSource : (market?.source ?? ""),
    compareAtEnabled: meta?.compareAtEnabled ?? false,
    regularPrice: prev?.regularPrice ?? null,
  });
}

/** All text read from the sources, as 5-gram shingles for the originality check. */
export function sourceShingles(project: ProjectRecord) {
  return shingles(
    project.extractions
      .map((e) => [e.title, e.description, e.rawText].filter(Boolean).join("\n"))
      .join("\n"),
  );
}

/**
 * Originality guarantee: score each description section's prose against the source and
 * regenerate any section above 20% overlap (up to 3 attempts inside the rewrite call).
 */
export async function enforceOriginality(
  project: ProjectRecord,
  html: string,
  source: Set<string>,
): Promise<{ html: string; findings: SimilarityFinding[] }> {
  const sections = splitSections(html);
  const findings: SimilarityFinding[] = [];
  if (!source.size) return { html, findings };
  for (const section of sections) {
    const score = round2(overlapScore(sectionProse(section.html), source));
    if (score <= SIMILARITY_THRESHOLD) {
      findings.push({ section: section.key, score, regenerated: false, finalScore: score });
      continue;
    }
    const phrases = sharedPhrases(sectionProse(section.html), source);
    const original = section.html;
    let next = original;
    try {
      next = await rewriteField({
        project,
        label: `Description section "${section.key}"`,
        current: section.html,
        operation: "regenerate",
        html: true,
        instruction: `This section reuses ${Math.round(score * 100)}% of its wording from the source page. Rewrite it completely in your own words and structure, keeping the facts and the heading. Do not reuse these phrases: ${phrases.map((p) => `"${p}"`).join(", ")}.`,
        check: (v) => {
          const s = overlapScore(sectionProse(v), source);
          return s > SIMILARITY_THRESHOLD
            ? [
                `- value: still ${Math.round(s * 100)}% overlap with the source; rewrite more thoroughly`,
              ]
            : [];
        },
        fixture: () => {
          const fresh = splitSections(fixtureListing(project).descriptionHtml).find(
            (s) => s.key === section.key,
          );
          return fresh?.html ?? `<p>[CONFIRM: rewrite this section in your own words]</p>`;
        },
      });
    } catch {
      // Keep the section and report it; the merchant sees the score and can rewrite it.
    }
    section.html = next;
    findings.push({
      section: section.key,
      score,
      regenerated: next !== original,
      finalScore: round2(overlapScore(sectionProse(next), source)),
    });
  }
  return { html: joinSections(sections), findings };
}

async function ensurePrereqs(ctx: JobContext, at: (f: number) => number) {
  let project = await getProject(ctx.projectId);
  if (!project.analysis) {
    await runAnalyze(ctx, { range: [at(0), at(0.15)] });
    project = await getProject(ctx.projectId);
  }
  if (!project.brandKit?.selectedName) {
    await runBrand(ctx, { range: [at(0.15), at(0.3)] });
    project = await getProject(ctx.projectId);
  }
  return project;
}

function grams(project: ProjectRecord): number {
  for (const e of project.extractions) {
    for (const [k, v] of Object.entries(e.specs)) {
      if (/weight/i.test(k)) {
        const g = parseGrams(v);
        if (g) return g;
      }
    }
  }
  return 0;
}

/** Step 4: pricing → copy → originality check → variants → SEO pass. */
export async function runListing(
  ctx: JobContext,
  opts: { range?: Range; instruction?: string } = {},
) {
  const at = span(opts.range);
  let project = await ensurePrereqs(ctx, at);
  const pricing = pricingFor(project);
  await ctx.progress("listing", at(0.35), "Writing the product listing");
  const out = await generateListing(project, { pricing, instruction: opts.instruction });

  await ctx.progress("listing", at(0.55), "Checking the copy is original");
  const { html, findings } = await enforceOriginality(
    project,
    out.descriptionHtml,
    sourceShingles(project),
  );

  const brand = project.brandKit?.selectedName ?? "";
  const matrix = buildMatrix(
    out.options,
    {
      price: pricing.suggestedPrice,
      skuPrefix: skuPrefix(brand, out.productType),
      grams: grams(project),
      costPerItem: pricing.unitCost,
      compareAtPrice: pricing.compareAtPrice,
    },
    // On regeneration, keep what the merchant set per variant (SKU, stock, barcode…).
    project.listing?.variants ?? [],
  );

  await ctx.progress("listing", at(0.75), "SEO pass: title, meta description, handle, alt text");
  project = await getProject(ctx.projectId);
  const assets = await orderedActiveAssets(ctx.projectId);
  const seo = await generateSeo(project, { ...out, descriptionHtml: html }, assets);
  for (const a of seo.altTexts) {
    await prisma.asset.update({ where: { id: a.assetId }, data: { altText: a.altText } });
  }

  const listing = ProductListing.parse({
    title: out.title,
    handle: seo.handle,
    vendor: brand,
    productType: out.productType,
    shopifyCategory: out.shopifyCategory,
    tags: out.tags,
    descriptionHtml: html,
    seoTitle: seo.seoTitle,
    seoDescription: seo.seoDescription,
    options: matrix.options,
    variants: matrix.variants,
    status: project.listing?.status ?? "draft",
  });
  const meta: ListingMeta = refreshListingMeta(listing, {
    ...(project.listingMeta ?? ListingMeta.parse({})),
    similarity: findings,
    pricing,
    warnings: matrix.warnings,
  });
  await updateProject(ctx.projectId, {
    listing,
    listingMeta: meta,
    changed: ["listing", ...(seo.altTexts.length ? (["images"] as const) : [])],
    steps: { listing: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  const flagged = findings.filter((f) => f.score > SIMILARITY_THRESHOLD);
  await ctx.progress("listing", at(1), "Listing ready", { title: listing.title });
  return {
    title: listing.title,
    variants: listing.variants.length,
    price: pricing.suggestedPrice,
    confirmMarkers: meta.confirmMarkers.length,
    similarityRewrites: flagged.length,
  };
}

/** Re-run only the SEO pass on the current listing. */
export async function runSeo(ctx: JobContext) {
  const project = await getProject(ctx.projectId);
  if (!project.listing) throw new UserFacingError("Generate the product listing first.");
  const assets = await orderedActiveAssets(ctx.projectId);
  await ctx.progress("seo", 30, "SEO pass: title, meta description, handle, alt text");
  const seo = await generateSeo(project, project.listing, assets);
  for (const a of seo.altTexts) {
    await prisma.asset.update({ where: { id: a.assetId }, data: { altText: a.altText } });
  }
  const listing = {
    ...project.listing,
    seoTitle: seo.seoTitle,
    seoDescription: seo.seoDescription,
    handle: seo.handle,
  };
  await updateProject(ctx.projectId, {
    listing,
    listingMeta: refreshListingMeta(listing, project.listingMeta),
    changed: ["listing", ...(seo.altTexts.length ? (["images"] as const) : [])],
    steps: { listing: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  return { seoTitle: seo.seoTitle, handle: seo.handle, altTexts: seo.altTexts.length };
}
