import { z } from "zod";
import { ProjectInputs, TONES, Tone } from "@/lib/schemas";

const optionalNumber = (label: string, opts: { min?: number; max?: number } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= (opts.min ?? 0)), {
      message: `${label} must be a number${opts.min !== undefined ? ` ≥ ${opts.min}` : ""}`,
    })
    .refine((v) => v === "" || opts.max === undefined || Number(v) <= opts.max, {
      message: `${label} must be ≤ ${opts.max}`,
    });

const isHttpUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
};

/** Step 1 form values (strings as typed); converted to ProjectInputs on save. */
export const InputFormValues = z
  .object({
    urls: z.array(z.object({ value: z.string().trim().max(2000) })).length(3),
    niche: z.string().max(200),
    targetCustomer: z.string().max(500),
    tone: Tone,
    brandName: z.string().max(60),
    targetPrice: optionalNumber("Target price", { min: 0.01 }),
    targetMarginPct: optionalNumber("Target margin", { min: 0, max: 95 }),
    unitCost: optionalNumber("Unit cost", { min: 0 }),
    shippingOrigin: z.string().max(100),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code like USD"),
    targetMarket: z.string().max(100),
    competitorUrls: z.string().max(2000),
    notes: z.string().max(4000),
    rightsAccepted: z.boolean(),
  })
  .superRefine((v, ctx) => {
    v.urls.forEach((u, i) => {
      if (u.value && !isHttpUrl(u.value)) {
        ctx.addIssue({
          code: "custom",
          path: ["urls", i, "value"],
          message: "Enter a full http(s) URL, e.g. https://example.com/product",
        });
      }
    });
    v.competitorUrls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((u) => {
        if (!isHttpUrl(u)) {
          ctx.addIssue({
            code: "custom",
            path: ["competitorUrls"],
            message: `Not a valid URL: ${u}`,
          });
        }
      });
  });
export type InputFormValues = z.infer<typeof InputFormValues>;

/** Extra checks applied only when the user submits to generate (not for autosave). */
export function submitIssues(v: InputFormValues, imageCount: number) {
  const issues: { path: string; message: string }[] = [];
  const urls = v.urls.map((u) => u.value).filter(Boolean);
  if (urls.length === 0 && imageCount === 0) {
    issues.push({
      path: "urls.0.value",
      message: "Add at least one product URL or upload at least one image.",
    });
  }
  if (!v.rightsAccepted) {
    issues.push({
      path: "rightsAccepted",
      message: "Confirm you have the right to use these images and product information.",
    });
  }
  return issues;
}

const LANGUAGE_BY_MARKET: [RegExp, string][] = [
  [/germany|deutschland|austria|österreich|switzerland/i, "de"],
  [/france|belgique|québec|quebec/i, "fr"],
  [/spain|españa|mexico|méxico|argentina|colombia|chile|peru/i, "es"],
  [/italy|italia/i, "it"],
  [/netherlands|nederland/i, "nl"],
  [/portugal|brazil|brasil/i, "pt"],
  [/japan/i, "ja"],
  [/sweden|sverige/i, "sv"],
  [/denmark|danmark/i, "da"],
  [/poland|polska/i, "pl"],
];

export function languageForMarket(market: string) {
  for (const [re, lang] of LANGUAGE_BY_MARKET) if (re.test(market)) return lang;
  return "en";
}

export function toProjectInputs(v: InputFormValues): ProjectInputs {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return ProjectInputs.parse({
    urls: v.urls.map((u) => u.value.trim()).filter(Boolean),
    context: {
      niche: v.niche.trim(),
      targetCustomer: v.targetCustomer.trim(),
      tone: v.tone,
      brandName: v.brandName.trim(),
      targetPrice: num(v.targetPrice),
      targetMarginPct: num(v.targetMarginPct),
      unitCost: num(v.unitCost),
      shippingOrigin: v.shippingOrigin.trim(),
      currency: v.currency.trim().toUpperCase(),
      targetMarket: v.targetMarket.trim() || "United States",
      language: languageForMarket(v.targetMarket),
      competitorUrls: v.competitorUrls.split(/\s+/).filter(Boolean).slice(0, 5),
      notes: v.notes.trim(),
    },
  });
}

export function fromProjectInputs(inputs: ProjectInputs, rightsAccepted: boolean): InputFormValues {
  const c = inputs.context;
  const s = (n: number | null) => (n == null ? "" : String(n));
  return {
    urls: [0, 1, 2].map((i) => ({ value: inputs.urls[i] ?? "" })),
    niche: c.niche,
    targetCustomer: c.targetCustomer,
    tone: c.tone,
    brandName: c.brandName,
    targetPrice: s(c.targetPrice),
    targetMarginPct: s(c.targetMarginPct),
    unitCost: s(c.unitCost),
    shippingOrigin: c.shippingOrigin,
    currency: c.currency,
    targetMarket: c.targetMarket,
    competitorUrls: c.competitorUrls.join("\n"),
    notes: c.notes,
    rightsAccepted,
  };
}

export { TONES };
