import { z } from "zod";

export const IMAGE_ROLES = ["hero", "angle", "lifestyle", "detail", "infographic"] as const;
export const ImageRole = z.enum(IMAGE_ROLES);
export type ImageRole = z.infer<typeof ImageRole>;

export const ImageFlag = z.object({
  code: z.enum([
    "low_resolution",
    "blurry",
    "under_exposed",
    "over_exposed",
    "extreme_aspect",
    "watermark",
    "text_overlay",
    "third_party_source",
    "duplicate",
    "background_removed",
    "not_product",
  ]),
  message: z.string(),
});
export type ImageFlag = z.infer<typeof ImageFlag>;

export const ImageAsset = z.object({
  id: z.string(),
  origin: z.enum(["upload", "scraped"]),
  sourceUrl: z.string().nullable().default(null),
  originalPath: z.string(),
  processedPath: z.string().nullable().default(null),
  mimeType: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  phash: z.string().nullable().default(null),
  qualityScore: z.number().int().min(0).max(100).nullable().default(null),
  qualityNote: z.string().nullable().default(null),
  flags: z.array(ImageFlag).default([]),
  altText: z.string().max(125).default(""),
  position: z.number().int().min(0),
  variantKey: z.string().nullable().default(null),
  isHero: z.boolean().default(false),
  discarded: z.boolean().default(false),
  discardReason: z.string().nullable().default(null),
  role: ImageRole.nullable().default(null),
});
export type ImageAsset = z.infer<typeof ImageAsset>;

export const ImagePatch = z.object({
  order: z.array(z.string()).optional(),
  heroId: z.string().optional(),
  updates: z
    .array(
      z.object({
        id: z.string(),
        altText: z.string().max(125).optional(),
        variantKey: z.string().max(100).nullable().optional(),
        discarded: z.boolean().optional(),
      }),
    )
    .optional(),
  deleteIds: z.array(z.string()).optional(),
});
export type ImagePatch = z.infer<typeof ImagePatch>;

export const ImageProcessOptions = z.object({
  squarePad: z.boolean().default(true),
  background: z.enum(["white", "brand"]).default("white"),
  removeBackground: z.boolean().default(false),
});
export type ImageProcessOptions = z.infer<typeof ImageProcessOptions>;
