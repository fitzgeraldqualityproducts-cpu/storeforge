import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectRecord } from "@/lib/db/projects";
import { detectSourceRisks } from "@/lib/guardrails";
import { RiskCategory, Severity, type RiskFlag } from "@/lib/schemas";
import type { AnalysisOutput } from "./analyze";
import { productFacts } from "./context";
import { RISK_SYSTEM } from "./prompts/risk";
import { callStructured } from "./structured";

const RiskOutput = z.object({
  flags: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{2,60}$/),
        severity: Severity,
        category: RiskCategory,
        message: z.string().min(5).max(500),
        suggestedFix: z.string().min(5).max(500),
      }),
    )
    .max(15),
});

const flagId = (prefix: string, text: string) =>
  `${prefix}-${createHash("sha1").update(text).digest("hex").slice(0, 8)}`;

/** Source text the risk review looks at (scraped data + merchant notes + what vision saw). */
export function riskText(
  project: ProjectRecord,
  analysis?: Pick<AnalysisOutput, "detectedText" | "summary"> | null,
) {
  const e = project.extractions;
  return [
    ...e.flatMap((x) => [
      x.title,
      x.description,
      x.brand,
      Object.entries(x.specs)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
      x.rawText.slice(0, 8000),
    ]),
    project.inputs.context.notes,
    project.inputs.context.niche,
    ...(analysis ? [analysis.summary, ...analysis.detectedText] : []),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Rule-based detectors (deterministic, always on) merged with the AI review. Rule flags are
 * kept even if the AI disagrees; AI flags that duplicate a rule's category+severity are dropped.
 */
export async function assessRisk(
  project: ProjectRecord,
  analysis: AnalysisOutput,
  opts: { watermarkedImages: number; scrapedImages: number },
): Promise<RiskFlag[]> {
  const text = riskText(project, analysis);
  const rules: RiskFlag[] = detectSourceRisks(text, opts.scrapedImages).map((f) => ({
    ...f,
    id: flagId("rule", `${f.category}|${f.message}`),
    acknowledged: false,
    source: "rules",
  }));
  if (opts.watermarkedImages > 0) {
    rules.push({
      id: flagId("rule", "watermark"),
      severity: "warn",
      category: "watermark",
      message: `${opts.watermarkedImages} image${opts.watermarkedImages === 1 ? " has" : "s have"} a visible watermark or store logo.`,
      suggestedFix:
        "Replace watermarked photos with your own or the supplier's licensed originals.",
      acknowledged: false,
      source: "rules",
    });
  }
  if (opts.scrapedImages > 0) {
    rules.push({
      id: flagId("rule", "third-party-images"),
      severity: "warn",
      category: "copyright",
      message: `${opts.scrapedImages} image${opts.scrapedImages === 1 ? " was" : "s were"} downloaded from a third-party page and may be copyrighted.`,
      suggestedFix: "Only publish photos you took or have written permission to use.",
      acknowledged: false,
      source: "rules",
    });
  }
  if (!analysis.isProduct) {
    rules.push({
      id: flagId("rule", "not-a-product"),
      severity: "warn",
      category: "other",
      message: "The page or photos don't look like a single product for sale.",
      suggestedFix: "Check the URL points to a product page, or upload photos of the product.",
      acknowledged: false,
      source: "rules",
    });
  }

  const out = await callStructured({
    task: "assessRisk",
    projectId: project.id,
    system: RISK_SYSTEM,
    content: [
      {
        type: "text",
        text: `${productFacts(project)}\n\nPRODUCT ANALYSIS\nProduct: ${analysis.productName} (${analysis.productType})\nSummary: ${analysis.summary}\nMaterials: ${analysis.materials.join(", ") || "unknown"}\nText/logos visible on the product: ${analysis.detectedText.join("; ") || "none"}\nImage notes: ${analysis.imageIssues.join("; ") || "none"}\n\nAutomated checks already raised these flags (don't repeat them):\n${rules.map((r) => `- [${r.severity}] ${r.category}: ${r.message}`).join("\n") || "- none"}\n\nReview the product and return any additional risk flags.`,
      },
    ],
    schema: RiskOutput,
    toolName: "record_risk_flags",
    toolDescription: "Record the risk flags found for this product.",
    maxTokens: 6000,
    fixture: () => ({
      flags: [
        {
          id: "market-compliance",
          severity: "info" as const,
          category: "labeling" as const,
          message: `Check labelling and safety rules for selling this product in ${project.inputs.context.targetMarket}.`,
          suggestedFix: "Ask your supplier for the product's compliance documents for your market.",
        },
      ],
    }),
  });

  const ruleKeys = new Set(rules.map((r) => `${r.category}|${r.severity}`));
  const ai: RiskFlag[] = out.flags
    .filter((f) => !ruleKeys.has(`${f.category}|${f.severity}`))
    .map((f) => ({ ...f, id: `ai-${f.id}`, acknowledged: false, source: "ai" }));
  const order = { block: 0, warn: 1, info: 2 } as const;
  return [...rules, ...ai].sort((a, b) => order[a.severity] - order[b.severity]);
}
