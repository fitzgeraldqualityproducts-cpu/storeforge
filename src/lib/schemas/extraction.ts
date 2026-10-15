import { z } from "zod";

export const ExtractionWarning = z.object({
  code: z.enum([
    "robots_disallowed",
    "anti_bot",
    "captcha",
    "login_wall",
    "thin_content",
    "fetch_failed",
    "blocked_url",
    "not_html",
    "too_large",
    "timeout",
    "browser_unavailable",
    "no_images",
    "llm_fallback_used",
    "llm_fallback_unavailable",
    "non_product_page",
    "variant_cap",
  ]),
  message: z.string(),
});
export type ExtractionWarning = z.infer<typeof ExtractionWarning>;

export const ExtractedOption = z.object({
  name: z.string(),
  values: z.array(z.string()),
});
export type ExtractedOption = z.infer<typeof ExtractedOption>;

export const ExtractedVariant = z.object({
  title: z.string().default(""),
  options: z.array(z.string()).default([]),
  sku: z.string().nullable().default(null),
  price: z.number().nullable().default(null),
  available: z.boolean().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
});
export type ExtractedVariant = z.infer<typeof ExtractedVariant>;

export const ExtractedImage = z.object({
  url: z.string(),
  alt: z.string().default(""),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
  source: z.enum(["jsonld", "og", "twitter", "img", "srcset", "lazy", "adapter", "microdata"]),
});
export type ExtractedImage = z.infer<typeof ExtractedImage>;

export const SourceExtraction = z.object({
  url: z.string(),
  finalUrl: z.string().nullable().default(null),
  sourceDomain: z.string().default(""),
  fetchMethod: z.enum(["static", "browser", "adapter", "none"]),
  adapter: z.string().nullable().default(null),
  fetchedAt: z.string(),
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  price: z.object({ amount: z.number(), currency: z.string() }).nullable().default(null),
  brand: z.string().nullable().default(null),
  sku: z.string().nullable().default(null),
  gtin: z.string().nullable().default(null),
  availability: z.string().nullable().default(null),
  options: z.array(ExtractedOption).default([]),
  variants: z.array(ExtractedVariant).default([]),
  specs: z.record(z.string(), z.string()).default({}),
  images: z.array(ExtractedImage).default([]),
  rating: z.object({ value: z.number(), count: z.number().nullable() }).nullable().default(null),
  shippingInfo: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  rawText: z.string().default(""),
  jsonLd: z.array(z.unknown()).default([]),
  warnings: z.array(ExtractionWarning).default([]),
});
export type SourceExtraction = z.infer<typeof SourceExtraction>;
