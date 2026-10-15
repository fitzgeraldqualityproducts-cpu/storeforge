import { z } from "zod";
import { Handle } from "./common";

export const MAX_VARIANTS = 2048;
export const MAX_OPTIONS = 3;

export const ProductOption = z.object({
  name: z.string().min(1).max(255),
  values: z.array(z.string().min(1).max(255)).min(1),
});
export type ProductOption = z.infer<typeof ProductOption>;

export const ProductVariant = z.object({
  option1: z.string(),
  option2: z.string().nullable().optional(),
  option3: z.string().nullable().optional(),
  sku: z.string().max(255),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().nullable().optional(),
  costPerItem: z.number().nonnegative().nullable().optional(),
  grams: z.number().int().nonnegative(),
  inventoryQty: z.number().int(),
  barcode: z.string().nullable().optional(),
  imageId: z.string().nullable().optional(),
});
export type ProductVariant = z.infer<typeof ProductVariant>;

export const ProductListing = z.object({
  title: z.string().min(1).max(255),
  handle: Handle,
  vendor: z.string().max(255),
  productType: z.string().max(255),
  shopifyCategory: z.string().max(500).default(""),
  tags: z.array(z.string().min(1).max(255)).max(13),
  descriptionHtml: z.string(),
  seoTitle: z.string().max(70),
  seoDescription: z.string().max(320),
  options: z.array(ProductOption).max(MAX_OPTIONS),
  variants: z.array(ProductVariant).min(1).max(MAX_VARIANTS),
  status: z.enum(["draft", "active"]).default("draft"),
});
export type ProductListing = z.infer<typeof ProductListing>;

export const PricingSuggestion = z.object({
  unitCost: z.number().nullable(),
  targetMarginPct: z.number().nullable(),
  competitorPrice: z.number().nullable(),
  suggestedPrice: z.number(),
  compareAtPrice: z.number().nullable(),
  marginPct: z.number().nullable(),
  steps: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PricingSuggestion = z.infer<typeof PricingSuggestion>;

export const SimilarityFinding = z.object({
  section: z.string(),
  score: z.number(),
  regenerated: z.boolean(),
  finalScore: z.number(),
});
export type SimilarityFinding = z.infer<typeof SimilarityFinding>;

export const ListingMeta = z.object({
  similarity: z.array(SimilarityFinding).default([]),
  confirmMarkers: z.array(z.string()).default([]),
  pricing: PricingSuggestion.nullable().default(null),
  compareAtEnabled: z.boolean().default(false),
  guardrailViolations: z.array(z.string()).default([]),
});
export type ListingMeta = z.infer<typeof ListingMeta>;
