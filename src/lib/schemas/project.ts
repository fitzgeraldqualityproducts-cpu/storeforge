import { z } from "zod";
import { Tone, WIZARD_STEPS, WizardStep } from "./common";

export const ProjectContext = z.object({
  niche: z.string().max(200).default(""),
  targetCustomer: z.string().max(500).default(""),
  tone: Tone.default("Minimal"),
  brandName: z.string().max(60).default(""),
  /** Target retail price in the project currency (optional). */
  targetPrice: z.number().positive().nullable().default(null),
  /** Target gross margin as a percentage, e.g. 60 for 60% (optional). */
  targetMarginPct: z.number().min(0).max(95).nullable().default(null),
  /** Unit cost (product + shipping) if known. */
  unitCost: z.number().nonnegative().nullable().default(null),
  shippingOrigin: z.string().max(100).default(""),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD"),
  targetMarket: z.string().max(100).default("United States"),
  /** BCP-47-ish language code for customer-facing copy; derived from target market when empty. */
  language: z.string().max(20).default("en"),
  competitorUrls: z.array(z.string().url()).max(5).default([]),
  notes: z.string().max(4000).default(""),
});
export type ProjectContext = z.infer<typeof ProjectContext>;

export const ProjectInputs = z.object({
  urls: z.array(z.string().url()).max(3).default([]),
  context: ProjectContext.default(ProjectContext.parse({})),
});
export type ProjectInputs = z.infer<typeof ProjectInputs>;

export const RightsAck = z.object({
  accepted: z.boolean(),
  at: z.string().datetime().nullable(),
});
export type RightsAck = z.infer<typeof RightsAck>;

export const StepStatus = z.enum(["empty", "running", "ready", "stale", "error"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const StepState = z.object({
  status: StepStatus.default("empty"),
  updatedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type StepState = z.infer<typeof StepState>;

const stepShape = Object.fromEntries(
  WIZARD_STEPS.map((s) => [s, StepState.default(StepState.parse({}))]),
) as Record<WizardStep, z.ZodDefault<typeof StepState>>;
export const StepsState = z.object(stepShape);
export type StepsState = z.infer<typeof StepsState>;

export const ProjectStatus = z.enum(["draft", "generating", "ready", "exported"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/** Fields shared by the API representation of a project (JSON columns already parsed). */
export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: ProjectStatus,
  inputs: ProjectInputs,
  rightsAck: RightsAck,
  steps: StepsState,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/** Validation for the Step 1 form (client + server). */
export const InputStepForm = z
  .object({
    urls: z.array(z.string().trim()).max(3),
    context: ProjectContext,
    rightsAccepted: z.literal(true, {
      error: "You must confirm you have the right to use these images and product information.",
    }),
    imageCount: z.number().int().min(0).max(20),
  })
  .superRefine((v, ctx) => {
    const urls = v.urls.filter((u) => u.length > 0);
    urls.forEach((u, i) => {
      let ok = false;
      try {
        const parsed = new URL(u);
        ok = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        ok = false;
      }
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["urls", i],
          message: "Enter a full http(s) URL, e.g. https://example.com/product",
        });
    });
    if (urls.length === 0 && v.imageCount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["urls", 0],
        message: "Add at least one product URL or upload at least one image.",
      });
    }
  });
export type InputStepForm = z.infer<typeof InputStepForm>;
