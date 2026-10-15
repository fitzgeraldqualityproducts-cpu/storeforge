import { z } from "zod";
import { Severity } from "./common";
import { ImageRole } from "./image";

export const RISK_CATEGORIES = [
  "trademark",
  "claims",
  "medical",
  "copyright",
  "watermark",
  "restricted_category",
  "prohibited_category",
  "counterfeit",
  "child_safety",
  "battery_shipping",
  "labeling",
  "other",
] as const;
export const RiskCategory = z.enum(RISK_CATEGORIES);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const RiskFlag = z.object({
  id: z.string(),
  severity: Severity,
  category: RiskCategory,
  message: z.string(),
  suggestedFix: z.string(),
  acknowledged: z.boolean().default(false),
  source: z.enum(["ai", "rules"]).default("ai"),
});
export type RiskFlag = z.infer<typeof RiskFlag>;

export const ProductAnalysis = z.object({
  /** Plain descriptive name of what the product is (not a brand name). */
  productName: z.string().default(""),
  productType: z.string(),
  summary: z.string(),
  materials: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([]),
  audience: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  detectedText: z.array(z.string()).default([]),
  isProduct: z.boolean().default(true),
  sourceLanguage: z.string().default("en"),
  imageIssues: z.array(z.string()).default([]),
  riskFlags: z.array(RiskFlag).default([]),
});
export type ProductAnalysis = z.infer<typeof ProductAnalysis>;

/** Per-image vision output produced alongside the analysis. */
export const ImageVisionResult = z.object({
  imageId: z.string(),
  altText: z.string().max(125),
  role: ImageRole,
  hasWatermark: z.boolean(),
  hasTextOverlay: z.boolean(),
  isProductVisible: z.boolean(),
  qualityIssues: z.array(z.string()).default([]),
});
export type ImageVisionResult = z.infer<typeof ImageVisionResult>;
