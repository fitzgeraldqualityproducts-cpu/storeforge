import "server-only";
import { analyzeProductImages } from "@/lib/ai/analyze";
import { assessRisk } from "@/lib/ai/risk";
import { llmScrapeFallback } from "@/lib/ai/scrape-fallback";
import { isAiConfigured } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { orderedActiveAssets } from "@/lib/db/assets";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import type { JobContext } from "@/lib/jobs/runner";
import type { ImageFlag, ProductAnalysis, RiskFlag } from "@/lib/schemas";
import { runExtract } from "./extract";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  pl: "Polish",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
};
const langName = (code: string) => LANGUAGE_NAMES[code.slice(0, 2).toLowerCase()] ?? code;

/** The scraper's LLM fallback, when AI is available (live key or offline fixture mode). */
export function scrapeFallbackFor(projectId: string) {
  return isAiConfigured() ? llmScrapeFallback(projectId) : null;
}

/**
 * Step 2: (re)read sources if needed, run the multimodal analysis, store per-image findings on
 * the assets, then run the risk review (rules + AI). Acknowledgements survive re-runs.
 */
export async function runAnalyze(ctx: JobContext, opts: { range?: [number, number] } = {}) {
  const [lo, hi] = opts.range ?? [0, 100];
  const at = (f: number) => lo + (hi - lo) * f;
  let project = await getProject(ctx.projectId);

  if (project.inputs.urls.length && project.extractions.length === 0) {
    await runExtract(ctx, {
      llmFallback: scrapeFallbackFor(ctx.projectId),
      range: [at(0), at(0.3)],
    });
    project = await getProject(ctx.projectId);
  }
  const assets = await orderedActiveAssets(ctx.projectId);
  const hasText = project.extractions.some((e) => e.title || e.description);
  if (!assets.length && !hasText) {
    throw new UserFacingError(
      "We couldn't read the product page and there are no photos yet. Upload a few product photos in Step 1 and retry.",
    );
  }

  await ctx.progress(
    "analysis",
    at(0.35),
    `Looking at ${assets.length} photo${assets.length === 1 ? "" : "s"} and the product data`,
  );
  const { analysis, vision } = await analyzeProductImages(project, assets);

  // Store per-image findings on the assets (alt text, role, vision flags).
  for (const v of vision) {
    const asset = assets.find((a) => a.id === v.imageId);
    if (!asset) continue;
    const keep = asset.flags.filter(
      (f) => !["watermark", "text_overlay", "not_product"].includes(f.code),
    );
    const add: ImageFlag[] = [];
    if (v.hasWatermark)
      add.push({
        code: "watermark",
        message: "A watermark is visible. Use a clean original you own.",
      });
    if (v.hasTextOverlay)
      add.push({
        code: "text_overlay",
        message: "Has text overlaid; fine for infographics, not for the hero.",
      });
    if (!v.isProductVisible)
      add.push({ code: "not_product", message: "Doesn't appear to show the product." });
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        altText: v.altText.slice(0, 125),
        role: v.role,
        flags: JSON.stringify([...keep, ...add]),
      },
    });
  }

  await ctx.progress("analysis", at(0.7), "Checking for trademark, claims and policy risks");
  const flags = await assessRisk(project, analysis, {
    watermarkedImages: vision.filter((v) => v.hasWatermark).length,
    scrapedImages: assets.filter((a) => a.origin === "scraped").length,
  });
  const target = project.inputs.context.language || "en";
  if (analysis.sourceLanguage && analysis.sourceLanguage.slice(0, 2) !== target.slice(0, 2)) {
    flags.push({
      id: "rule-translation",
      severity: "info",
      category: "other",
      message: `The source is in ${langName(analysis.sourceLanguage)}; your store copy will be written in ${langName(target)}.`,
      suggestedFix:
        "Have a native speaker skim the final copy, especially specs and care instructions.",
      acknowledged: false,
      source: "rules",
    });
  }
  // Keep the merchant's acknowledgements for flags that are still present.
  const previous = new Map((project.analysis?.riskFlags ?? []).map((f) => [f.id, f]));
  const riskFlags: RiskFlag[] = flags.map((f) => ({
    ...f,
    acknowledged: previous.get(f.id)?.acknowledged ?? false,
  }));

  const result: ProductAnalysis = {
    productName: analysis.productName,
    productType: analysis.productType,
    summary: analysis.summary,
    materials: analysis.materials,
    colors: analysis.colors,
    useCases: analysis.useCases,
    audience: analysis.audience,
    differentiators: analysis.differentiators,
    detectedText: analysis.detectedText,
    isProduct: analysis.isProduct,
    sourceLanguage: analysis.sourceLanguage,
    imageIssues: analysis.imageIssues,
    riskFlags,
  };
  await updateProject(ctx.projectId, {
    analysis: result,
    changed: ["analysis"],
    steps: { analysis: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  await ctx.progress(
    "analysis",
    at(1),
    `Analysis ready · ${riskFlags.length} flag${riskFlags.length === 1 ? "" : "s"}`,
    {
      productName: result.productName,
      flags: riskFlags.length,
    },
  );
  return {
    productName: result.productName,
    flags: riskFlags.length,
    blocking: riskFlags.filter((f) => f.severity === "block").length,
  };
}
