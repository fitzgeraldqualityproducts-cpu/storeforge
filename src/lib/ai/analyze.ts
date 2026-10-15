import "server-only";
import { z } from "zod";
import type { ProjectRecord } from "@/lib/db/projects";
import { ImageRole, type ImageAsset, type ImageVisionResult } from "@/lib/schemas";
import { styleOf, productFacts } from "./context";
import { fixtureAnalysis, fixtureImages, fixtureProductName } from "./fixtures/analysis";
import { ANALYZE_SYSTEM, DESCRIBE_IMAGES_SYSTEM } from "./prompts/analyze";
import { globalRules } from "./prompts/global";
import { callStructured } from "./structured";
import { MAX_VISION_IMAGES, visionBlocks } from "./vision";

const ImageFinding = z.object({
  index: z.number().int().min(1).describe("1-based index of the image as labelled"),
  altText: z.string().min(3).max(125),
  role: ImageRole,
  hasWatermark: z.boolean(),
  hasTextOverlay: z.boolean(),
  isProductVisible: z.boolean(),
  qualityIssues: z.array(z.string()).max(6),
});

export const AnalysisOutput = z.object({
  productName: z.string().min(2).max(120),
  productType: z.string().min(2).max(80),
  summary: z.string().min(10).max(800),
  materials: z.array(z.string()).max(10),
  colors: z.array(z.string()).max(12),
  useCases: z.array(z.string()).max(8),
  audience: z.array(z.string()).max(6),
  differentiators: z.array(z.string()).max(8),
  detectedText: z.array(z.string()).max(20),
  isProduct: z.boolean(),
  sourceLanguage: z.string().min(2).max(10),
  imageIssues: z.array(z.string()).max(10),
  images: z.array(ImageFinding),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutput>;

function toVision(
  assets: ImageAsset[],
  images: z.infer<typeof ImageFinding>[],
): ImageVisionResult[] {
  return images
    .filter((f) => f.index >= 1 && f.index <= assets.length)
    .map((f) => ({
      imageId: assets[f.index - 1]!.id,
      altText: f.altText,
      role: f.role,
      hasWatermark: f.hasWatermark,
      hasTextOverlay: f.hasTextOverlay,
      isProductVisible: f.isProductVisible,
      qualityIssues: f.qualityIssues,
    }));
}

/** Multimodal analysis: product facts + per-image role, alt text and watermark/text flags. */
export async function analyzeProductImages(project: ProjectRecord, assets: ImageAsset[]) {
  const used = assets.slice(0, MAX_VISION_IMAGES);
  const content = [
    ...(await visionBlocks(used)),
    {
      type: "text" as const,
      text: `${productFacts(project)}\n\nAnalyse the product shown in the ${used.length} image${used.length === 1 ? "" : "s"} above${project.extractions.length ? " together with the source data" : ""}. Return one entry in "images" per image index (1–${used.length}).`,
    },
  ];
  const style = styleOf(project);
  const out = await callStructured({
    task: "analyzeProductImages",
    projectId: project.id,
    system: `${ANALYZE_SYSTEM}\n\n${globalRules(style)}`,
    content: used.length ? content : [content[content.length - 1]!],
    schema: AnalysisOutput,
    toolName: "record_product_analysis",
    toolDescription: "Record the structured product analysis and per-image findings.",
    maxTokens: 12_000,
    check: (v) => {
      const missing = used.map((_, i) => i + 1).filter((n) => !v.images.some((f) => f.index === n));
      return missing.length
        ? [`- images: missing entries for image index ${missing.join(", ")}`]
        : [];
    },
    fixture: () => fixtureAnalysis(project, used),
  });
  return { analysis: out, vision: toVision(used, out.images) };
}

const DescribeOutput = z.object({ images: z.array(ImageFinding) });

/** Alt text + role + flags for images that weren't part of the analysis call. */
export async function describeImages(
  project: ProjectRecord,
  assets: ImageAsset[],
  title: string | null,
) {
  const results: ImageVisionResult[] = [];
  for (let start = 0; start < assets.length; start += MAX_VISION_IMAGES) {
    const batch = assets.slice(start, start + MAX_VISION_IMAGES);
    const out = await callStructured({
      task: "describeImages",
      projectId: project.id,
      system: `${DESCRIBE_IMAGES_SYSTEM}\n\n${globalRules(styleOf(project))}`,
      content: [
        ...(await visionBlocks(batch)),
        {
          type: "text",
          text: `The product is: ${title ?? "unknown"}. Return one entry per image index (1–${batch.length}).`,
        },
      ],
      schema: DescribeOutput,
      toolName: "record_image_findings",
      toolDescription: "Record alt text, role and quality flags for each image.",
      maxTokens: 6000,
      effort: "low",
      check: (v) => {
        const missing = batch
          .map((_, i) => i + 1)
          .filter((n) => !v.images.some((f) => f.index === n));
        return missing.length
          ? [`- images: missing entries for image index ${missing.join(", ")}`]
          : [];
      },
      fixture: () => ({ images: fixtureImages(title ?? fixtureProductName(project), batch) }),
    });
    results.push(...toVision(batch, out.images));
  }
  return results;
}
