import { z } from "zod";

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color like #1a2b3c");

export const Money = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

export const Severity = z.enum(["info", "warn", "block"]);
export type Severity = z.infer<typeof Severity>;

export const TONES = [
  "Premium",
  "Playful",
  "Minimal",
  "Bold",
  "Cozy",
  "Clinical",
  "Luxury",
] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

export const Handle = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes");

export const WIZARD_STEPS = [
  "input",
  "analysis",
  "brand",
  "listing",
  "images",
  "content",
  "export",
] as const;
export const WizardStep = z.enum(WIZARD_STEPS);
export type WizardStep = z.infer<typeof WizardStep>;
