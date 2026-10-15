import "server-only";
import { z } from "zod";
import type { ProjectRecord } from "@/lib/db/projects";
import { describeViolations, findViolationsDeep, WATCHED_BRANDS } from "@/lib/guardrails";
import { sanitizeListingHtml } from "@/lib/html/sanitize";
import { toHandle, truncateAtWord } from "@/lib/listing/text";
import type { ImageAsset, PricingSuggestion } from "@/lib/schemas";
import { productFacts, styleOf } from "./context";
import { fixtureListing, fixtureSeo } from "./fixtures/listing";
import { globalRules } from "./prompts/global";
import { LISTING_SYSTEM } from "./prompts/listing";
import { SEO_SYSTEM } from "./prompts/seo";
import { callStructured } from "./structured";
import { formatMoney } from "@/lib/utils";

export const ListingOutput = z.object({
  title: z.string().min(3).max(70),
  productType: z.string().min(2).max(80),
  shopifyCategory: z.string().max(500),
  tags: z.array(z.string().min(1).max(60)).min(1).max(13),
  descriptionHtml: z.string().min(50),
  seoTitle: z.string().min(5).max(70),
  seoDescription: z.string().min(20).max(320),
  handle: z.string().min(1).max(80),
  options: z
    .array(z.object({ name: z.string().min(1).max(60), values: z.array(z.string().min(1)).min(1) }))
    .max(3),
});
export type ListingOutput = z.infer<typeof ListingOutput>;

/** Brand names that must not appear in titles or tags (source brands + watched trademarks). */
export function forbiddenBrands(project: ProjectRecord) {
  const own = (project.brandKit?.selectedName ?? "").toLowerCase();
  return [
    ...project.extractions.map((e) => e.brand).filter((b): b is string => Boolean(b)),
    ...WATCHED_BRANDS,
  ].filter((b) => b.length >= 3 && b.toLowerCase() !== own);
}

function brandHits(text: string, brands: string[]) {
  const t = text.toLowerCase();
  return brands.filter((b) =>
    new RegExp(`\\b${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t),
  );
}

/** Product copy + options (variants are built in code from the options). */
export async function generateListing(
  project: ProjectRecord,
  opts: { pricing: PricingSuggestion | null; instruction?: string },
): Promise<ListingOutput> {
  const brand = project.brandKit?.selectedName ?? project.inputs.context.brandName ?? "";
  const brands = forbiddenBrands(project);
  const voice = project.brandKit?.voice;
  const price = opts.pricing?.suggestedPrice
    ? formatMoney(opts.pricing.suggestedPrice, opts.pricing.currency)
    : "not set";
  const out = await callStructured({
    task: "generateListing",
    projectId: project.id,
    system: `${LISTING_SYSTEM}\n\n${globalRules(styleOf(project))}`,
    content: [
      {
        type: "text",
        text: [
          productFacts(project, { includeAnalysis: true }),
          `Store brand (vendor): ${brand || "[not chosen yet]"}`,
          project.brandKit?.tagline ? `Tagline: ${project.brandKit.tagline}` : "",
          voice
            ? `Brand voice: ${voice.adjectives.join(", ")}\nDo: ${voice.do.join("; ")}\nDon't: ${voice.dont.join("; ")}`
            : "",
          `Suggested retail price: ${price}`,
          opts.instruction ? `Merchant instruction: ${opts.instruction}` : "",
          "Write the listing.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: ListingOutput,
    toolName: "record_product_listing",
    toolDescription: "Record the complete product listing.",
    maxTokens: 8000,
    effort: "medium",
    check: (v) => {
      const problems: string[] = [];
      const titleHits = brandHits(`${v.title} ${v.tags.join(" ")}`, brands);
      if (titleHits.length)
        problems.push(
          `- title/tags: remove other companies' brand names (${titleHits.join(", ")})`,
        );
      if ((v.descriptionHtml.match(/<h3/gi) ?? []).length < 3)
        problems.push("- descriptionHtml: use the <h3> section structure described");
      const g = findViolationsDeep({
        title: v.title,
        tags: v.tags,
        descriptionHtml: v.descriptionHtml,
        seoTitle: v.seoTitle,
        seoDescription: v.seoDescription,
      });
      if (g.length) problems.push(describeViolations(g));
      return problems;
    },
    fixture: () => fixtureListing(project),
  });
  return {
    ...out,
    title: out.title.trim(),
    tags: [...new Set(out.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 13),
    descriptionHtml: sanitizeListingHtml(out.descriptionHtml),
    handle: toHandle(out.handle || out.title),
  };
}

const SeoOutput = z.object({
  seoTitle: z.string().min(5).max(90),
  seoDescription: z.string().min(20).max(320),
  handle: z.string().min(1).max(120),
  altTexts: z.array(
    z.object({ index: z.number().int().min(1), altText: z.string().min(3).max(200) }),
  ),
});

export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 155;
export const HANDLE_MAX = 60;
export const ALT_MAX = 125;

/**
 * SEO pass: title, meta description, handle and alt text. Lengths are enforced in code
 * (truncated at word boundaries) whatever the model returns.
 */
export async function generateSeo(
  project: ProjectRecord,
  listing: {
    title: string;
    seoTitle: string;
    seoDescription: string;
    handle: string;
    descriptionHtml: string;
  },
  assets: ImageAsset[],
) {
  const used = assets.slice(0, 20);
  const out = await callStructured({
    task: "generateSeo",
    projectId: project.id,
    system: `${SEO_SYSTEM}\n\n${globalRules(styleOf(project))}`,
    content: [
      {
        type: "text",
        text: [
          `Store brand: ${project.brandKit?.selectedName ?? ""}`,
          `Product title: ${listing.title}`,
          `Current SEO title: ${listing.seoTitle}`,
          `Current meta description: ${listing.seoDescription}`,
          `Current handle: ${listing.handle}`,
          `Description (HTML):\n${listing.descriptionHtml.slice(0, 4000)}`,
          used.length
            ? `Images (index: current alt text, role):\n${used.map((a, i) => `${i + 1}: ${a.altText || "(none)"}, ${a.role ?? "unknown"}`).join("\n")}`
            : "No images.",
        ].join("\n\n"),
      },
    ],
    schema: SeoOutput,
    toolName: "record_seo",
    toolDescription: "Record the SEO title, meta description, handle and alt texts.",
    maxTokens: 3000,
    effort: "low",
    check: (v) => {
      const g = findViolationsDeep({
        seoTitle: v.seoTitle,
        seoDescription: v.seoDescription,
        alt: v.altTexts,
      });
      return g.length ? [describeViolations(g)] : [];
    },
    fixture: () => fixtureSeo(project, listing, used),
  });
  return {
    seoTitle: truncateAtWord(out.seoTitle, SEO_TITLE_MAX),
    seoDescription: truncateAtWord(out.seoDescription, SEO_DESCRIPTION_MAX),
    handle: toHandle(out.handle, HANDLE_MAX),
    altTexts: out.altTexts
      .filter((x) => x.index >= 1 && x.index <= used.length)
      .map((x) => ({
        assetId: used[x.index - 1]!.id,
        altText: truncateAtWord(x.altText, ALT_MAX),
      })),
  };
}
