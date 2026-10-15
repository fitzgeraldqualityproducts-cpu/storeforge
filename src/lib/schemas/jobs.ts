import { z } from "zod";

export const JOB_TYPES = [
  "extract",
  "images",
  "analyze",
  "brand_names",
  "brand_details",
  "listing",
  "content",
  "seo",
  "regenerate",
  "pipeline",
  "export_bundle",
  "export_shopify",
] as const;
export const JobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobView = z.object({
  id: z.string(),
  projectId: z.string(),
  type: JobType,
  status: JobStatus,
  step: z.string(),
  percent: z.number(),
  message: z.string(),
  error: z.string().nullable(),
  result: z.unknown().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type JobView = z.infer<typeof JobView>;

/** Event payload streamed over SSE. */
export const JobEvent = z.object({
  kind: z.enum(["job", "project"]),
  job: JobView.optional(),
  partial: z.unknown().optional(),
});
export type JobEvent = z.infer<typeof JobEvent>;

export const RegenerateSection = z.enum([
  "analysis",
  "risk",
  "brand_names",
  "brand_details",
  "listing",
  "listing_field",
  "content",
  "content_page",
  "seo",
  "alt_text",
]);
export type RegenerateSection = z.infer<typeof RegenerateSection>;

export const RewriteOperation = z.enum(["regenerate", "shorten", "change_tone"]);
export type RewriteOperation = z.infer<typeof RewriteOperation>;

export const RegenerateRequest = z.object({
  section: RegenerateSection,
  instruction: z.string().max(1000).optional(),
  /** For field-level rewrites: e.g. "title", "seoDescription", "descriptionHtml", "pages.about". */
  field: z.string().max(100).optional(),
  operation: RewriteOperation.optional(),
  tone: z.string().max(40).optional(),
});
export type RegenerateRequest = z.infer<typeof RegenerateRequest>;
