import "server-only";
import type { ProjectRecord } from "@/lib/db/projects";
import type { SourceExtraction } from "@/lib/schemas";

export function styleOf(project: ProjectRecord) {
  const c = project.inputs.context;
  return { tone: c.tone, language: c.language || "en", market: c.targetMarket || "United States" };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function extractionBlock(e: SourceExtraction, i: number, primary: boolean) {
  const lines: string[] = [];
  lines.push(
    `${primary ? "PRIMARY PRODUCT SOURCE" : `REFERENCE/COMPETITOR SOURCE ${i}`} (domain: ${e.sourceDomain || "unknown"})`,
  );
  if (e.title) lines.push(`Title: ${e.title}`);
  if (e.price) lines.push(`Price on source: ${e.price.amount} ${e.price.currency}`);
  if (e.brand) lines.push(`Brand on source (do not reuse in copy): ${e.brand}`);
  if (e.availability) lines.push(`Availability: ${e.availability}`);
  if (e.options.length)
    lines.push(
      `Options: ${e.options.map((o) => `${o.name} = ${o.values.join(" / ")}`).join("; ")}`,
    );
  const specs = Object.entries(e.specs);
  if (specs.length)
    lines.push(
      `Specs:\n${specs
        .slice(0, 40)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n")}`,
    );
  if (e.shippingInfo) lines.push(`Shipping info: ${clip(e.shippingInfo, 300)}`);
  if (e.language) lines.push(`Page language: ${e.language}`);
  if (e.description) lines.push(`Description: ${clip(e.description, primary ? 3000 : 800)}`);
  if (primary && e.rawText) lines.push(`Visible page text (trimmed):\n${clip(e.rawText, 6000)}`);
  return lines.join("\n");
}

/**
 * Everything the model may rely on, as one block. Scraped content and merchant notes are
 * wrapped in <source> tags so prompts can tell the model to treat them as data.
 */
export function productFacts(project: ProjectRecord, opts: { includeAnalysis?: boolean } = {}) {
  const c = project.inputs.context;
  const parts: string[] = [];
  const usable = project.extractions.filter((e) => e.title || e.description || e.rawText);
  if (usable.length) {
    parts.push(
      `<source>\n${usable.map((e, i) => extractionBlock(e, i, i === 0)).join("\n\n")}\n</source>`,
    );
  } else {
    parts.push("No product page was read; rely on the photos and the merchant's notes only.");
  }
  const ctx: string[] = [];
  if (c.niche) ctx.push(`Niche/category: ${c.niche}`);
  if (c.targetCustomer) ctx.push(`Target customer: ${c.targetCustomer}`);
  if (c.brandName) ctx.push(`Merchant's brand name: ${c.brandName}`);
  if (c.targetPrice != null) ctx.push(`Target retail price: ${c.targetPrice} ${c.currency}`);
  if (c.unitCost != null) ctx.push(`Unit cost: ${c.unitCost} ${c.currency}`);
  if (c.shippingOrigin) ctx.push(`Ships from: ${c.shippingOrigin}`);
  ctx.push(
    `Currency: ${c.currency}; target market: ${c.targetMarket}; copy language: ${c.language}`,
  );
  if (c.notes) ctx.push(`Merchant notes: ${clip(c.notes, 2000)}`);
  parts.push(`<source>\nMERCHANT CONTEXT\n${ctx.join("\n")}\n</source>`);
  if (opts.includeAnalysis && project.analysis) {
    const a = project.analysis;
    parts.push(
      [
        "PRODUCT ANALYSIS (reviewed by the merchant)",
        `Product: ${a.productName || a.productType}`,
        `Type: ${a.productType}`,
        `Summary: ${a.summary}`,
        a.materials.length ? `Materials: ${a.materials.join(", ")}` : "",
        a.colors.length ? `Colors: ${a.colors.join(", ")}` : "",
        a.useCases.length ? `Use cases: ${a.useCases.join("; ")}` : "",
        a.audience.length ? `Audience: ${a.audience.join("; ")}` : "",
        a.differentiators.length ? `Differentiators: ${a.differentiators.join("; ")}` : "",
        a.riskFlags.length
          ? `Risk notes to respect in copy: ${a.riskFlags.map((f) => f.message).join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parts.join("\n\n");
}
