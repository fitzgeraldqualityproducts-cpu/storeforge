import "server-only";
import { describeImages } from "@/lib/ai/analyze";
import { fixtureListing } from "@/lib/ai/fixtures/listing";
import { ALT_MAX, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@/lib/ai/listing";
import { rewriteField } from "@/lib/ai/rewrite";
import { isAiConfigured } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { orderedActiveAssets } from "@/lib/db/assets";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import type { JobContext } from "@/lib/jobs/runner";
import { refreshListingMeta } from "@/lib/listing/meta";
import { overlapScore, sectionProse, SIMILARITY_THRESHOLD } from "@/lib/listing/similarity";
import { truncateAtWord } from "@/lib/listing/text";
import { RegenerateRequest, type ProductListing } from "@/lib/schemas";
import { runAnalyze } from "./analyze";
import { runBrandDetails, runBrandNames } from "./brand";
import { rewriteContentField, runContent } from "./content";
import { runListing, runSeo, sourceShingles } from "./listing";

/** Store content fields (besides `pages.<handle>`) that support rewrites. */
export const CONTENT_FIELDS = ["announcementBar", "hero.headline", "hero.subheadline"];

/** Listing fields that support per-field regenerate / shorten / change tone. */
export const LISTING_FIELDS: Record<
  string,
  { key: keyof ProductListing; label: string; max?: number; html?: boolean }
> = {
  title: { key: "title", label: "Product title", max: 70 },
  descriptionHtml: { key: "descriptionHtml", label: "Product description", html: true },
  seoTitle: { key: "seoTitle", label: "SEO title", max: SEO_TITLE_MAX },
  seoDescription: { key: "seoDescription", label: "Meta description", max: SEO_DESCRIPTION_MAX },
  productType: { key: "productType", label: "Product type", max: 80 },
};

async function rewriteListingField(ctx: JobContext, req: RegenerateRequest) {
  const project = await getProject(ctx.projectId);
  const listing = project.listing;
  if (!listing) throw new UserFacingError("Generate the product listing first.");
  const spec = req.field ? LISTING_FIELDS[req.field] : undefined;
  if (!spec) throw new UserFacingError(`"${req.field ?? ""}" can't be rewritten.`);
  const operation = req.operation ?? "regenerate";
  await ctx.progress(
    "listing",
    20,
    `${operation === "shorten" ? "Shortening" : operation === "change_tone" ? "Changing the tone of" : "Rewriting"} the ${spec.label.toLowerCase()}`,
  );
  const source = sourceShingles(project);
  const value = await rewriteField({
    project,
    label: spec.label,
    current: String(listing[spec.key] ?? ""),
    operation,
    html: spec.html,
    tone: req.tone,
    instruction: req.instruction,
    maxLength: spec.max,
    check: (v) => {
      const s = overlapScore(spec.html ? sectionProse(v) : v, source);
      return s > SIMILARITY_THRESHOLD
        ? [
            `- value: ${Math.round(s * 100)}% of the wording matches the source page; use your own words`,
          ]
        : [];
    },
    fixture: () =>
      String(
        fixtureListing(project)[spec.key as keyof ReturnType<typeof fixtureListing>] ??
          listing[spec.key],
      ),
  });
  const next: ProductListing = { ...listing, [spec.key]: value };
  await updateProject(ctx.projectId, {
    listing: next,
    listingMeta: refreshListingMeta(next, project.listingMeta),
    changed: ["listing"],
    steps: { listing: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  return { field: req.field, operation, length: value.length };
}

async function regenerateAltText(ctx: JobContext) {
  if (!isAiConfigured()) {
    throw new UserFacingError("Alt text needs AI. Add ANTHROPIC_API_KEY or edit alt text by hand.");
  }
  const project = await getProject(ctx.projectId);
  const assets = await orderedActiveAssets(ctx.projectId);
  if (!assets.length) throw new UserFacingError("There are no images to describe.");
  await ctx.progress(
    "images",
    20,
    `Describing ${assets.length} image${assets.length === 1 ? "" : "s"}`,
  );
  const vision = await describeImages(
    project,
    assets,
    project.listing?.title ?? project.analysis?.productName ?? null,
  );
  for (const v of vision) {
    await prisma.asset.update({
      where: { id: v.imageId },
      data: { altText: truncateAtWord(v.altText, ALT_MAX) },
    });
  }
  await updateProject(ctx.projectId, { changed: ["images"] });
  return { altTexts: vision.length };
}

/** POST /regenerate {section, instruction, field?, operation?, tone?} dispatcher. */
export async function runRegenerate(ctx: JobContext) {
  const req = RegenerateRequest.parse(ctx.payload);
  switch (req.section) {
    case "analysis":
    case "risk":
      return runAnalyze(ctx);
    case "brand_names":
      return runBrandNames(ctx);
    case "brand_details":
      return runBrandDetails(ctx, {});
    case "listing":
      return runListing(ctx, { instruction: req.instruction });
    case "listing_field":
      return rewriteListingField(ctx, req);
    case "seo":
      return runSeo(ctx);
    case "alt_text":
      return regenerateAltText(ctx);
    case "content":
      return runContent(ctx, { instruction: req.instruction });
    case "content_page":
      return rewriteContentField(ctx, req);
  }
}
