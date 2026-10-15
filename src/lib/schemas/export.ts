import { z } from "zod";

export const ValidationIssue = z.object({
  level: z.enum(["error", "warning"]),
  check: z.string(),
  message: z.string(),
  row: z.number().nullable().default(null),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationReport = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  csvFormat: z.enum(["current", "legacy"]),
  rowCount: z.number(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
  issues: z.array(ValidationIssue),
  theme: z.object({ ok: z.boolean(), issues: z.array(z.string()) }).optional(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

export const ImageMode = z.enum(["public_url", "upload_after"]);
export type ImageMode = z.infer<typeof ImageMode>;

export const BundleOptions = z.object({
  imageMode: ImageMode.default("upload_after"),
  csvFormat: z.enum(["current", "legacy"]).default("current"),
});
export type BundleOptions = z.infer<typeof BundleOptions>;

export const ShopifyStepResult = z.object({
  step: z.string(),
  label: z.string(),
  status: z.enum(["pending", "skipped", "planned", "succeeded", "failed"]),
  detail: z.string().default(""),
  resourceIds: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
});
export type ShopifyStepResult = z.infer<typeof ShopifyStepResult>;

export const ShopifyResourceMap = z.object({
  productId: z.string().nullable().default(null),
  collectionIds: z.record(z.string(), z.string()).default({}),
  pageIds: z.record(z.string(), z.string()).default({}),
  menuIds: z.record(z.string(), z.string()).default({}),
  fileIds: z.record(z.string(), z.string()).default({}),
  themeId: z.string().nullable().default(null),
});
export type ShopifyResourceMap = z.infer<typeof ShopifyResourceMap>;

export const ShopifyPushResult = z.object({
  dryRun: z.boolean(),
  storeDomain: z.string(),
  apiVersion: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(ShopifyStepResult),
  resources: ShopifyResourceMap,
  plannedOperations: z.array(z.string()).default([]),
});
export type ShopifyPushResult = z.infer<typeof ShopifyPushResult>;

export const ShopifyPushRequest = z.object({
  dryRun: z.boolean().default(true),
  confirm: z.boolean().default(false),
  includeTheme: z.boolean().default(false),
  onlySteps: z.array(z.string()).optional(),
});
export type ShopifyPushRequest = z.infer<typeof ShopifyPushRequest>;

export const ExportRecord = z.object({
  id: z.string(),
  type: z.enum(["bundle", "shopify"]),
  createdAt: z.string(),
  artifactPath: z.string().nullable(),
  shopifyResult: ShopifyPushResult.nullable(),
  validationReport: ValidationReport.nullable(),
});
export type ExportRecord = z.infer<typeof ExportRecord>;
