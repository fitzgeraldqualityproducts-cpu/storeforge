import "server-only";
import { z } from "zod";
import { enforcePalette } from "@/lib/brand/contrast";
import { resolveFont } from "@/lib/brand/fonts";
import {
  checkName,
  finalizeCandidate,
  nameIsUsable,
  PREFERRED_MAX_LENGTH,
} from "@/lib/brand/names";
import type { ProjectRecord } from "@/lib/db/projects";
import { describeViolations, findViolationsDeep } from "@/lib/guardrails";
import { HexColor, type BrandKit, type NameCandidate } from "@/lib/schemas";
import { productFacts, styleOf } from "./context";
import { fixtureBrandDetails, fixtureBrandNames } from "./fixtures/brand";
import { BRAND_DETAILS_SYSTEM, BRAND_NAMES_SYSTEM } from "./prompts/brand";
import { globalRules, toneGuide } from "./prompts/global";
import { callStructured } from "./structured";

export const NamesOutput = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().min(2).max(24),
        rationale: z.string().min(5).max(240),
        domainSuggestion: z.string().min(4).max(80),
      }),
    )
    .length(6),
});

export const DetailsOutput = z.object({
  tagline: z.string().min(3).max(60),
  voice: z.object({
    adjectives: z.array(z.string().min(2).max(30)).min(3).max(5),
    do: z.array(z.string().min(3).max(160)).min(4).max(6),
    dont: z.array(z.string().min(3).max(160)).min(4).max(6),
  }),
  palette: z.object({
    primary: HexColor,
    secondary: HexColor,
    accent: HexColor,
    background: HexColor,
    text: HexColor,
    surface: HexColor,
  }),
  fonts: z.object({
    heading: z.string().min(2).max(60).describe("Exact Google Fonts family name"),
    body: z.string().min(2).max(60).describe("Exact Google Fonts family name"),
  }),
});

/** Brands named on the source pages: candidates must not reuse or resemble them. */
function sourceBrands(project: ProjectRecord) {
  return project.extractions.map((e) => e.brand).filter((b): b is string => Boolean(b));
}

/** Six name candidates with code-side syntactic checks and normalized domain suggestions. */
export async function generateBrandNames(project: ProjectRecord): Promise<NameCandidate[]> {
  const avoid = sourceBrands(project);
  const { tone } = styleOf(project);
  const out = await callStructured({
    task: "generateBrandNames",
    projectId: project.id,
    system: `${BRAND_NAMES_SYSTEM}\n\n${globalRules(styleOf(project))}`,
    content: [
      {
        type: "text",
        text: `${productFacts(project, { includeAnalysis: true })}\n\nRequested tone: ${tone} (${toneGuide(tone)})${avoid.length ? `\nDo not use or resemble these source brands: ${avoid.join(", ")}` : ""}\n\nPropose 6 brand names.`,
      },
    ],
    schema: NamesOutput,
    toolName: "record_brand_names",
    toolDescription: "Record exactly 6 brand name candidates.",
    maxTokens: 3000,
    effort: "medium",
    check: (v) => {
      const problems: string[] = [];
      const seen = new Set<string>();
      let long = 0;
      v.candidates.forEach((c, i) => {
        const checks = checkName(c.name, { avoid });
        if (!nameIsUsable(checks))
          problems.push(`- candidates[${i}].name "${c.name}": ${checks.notes.join("; ")}`);
        if (checks.length > PREFERRED_MAX_LENGTH) long++;
        const k = c.name.toLowerCase();
        if (seen.has(k)) problems.push(`- candidates[${i}].name "${c.name}" is a duplicate`);
        seen.add(k);
        if (/\bavailable\b/i.test(c.rationale) || /\bavailable\b/i.test(c.domainSuggestion))
          problems.push(`- candidates[${i}]: don't claim the name or domain is available`);
      });
      if (long > 2)
        problems.push(
          `- ${long} names are over ${PREFERRED_MAX_LENGTH} characters; keep at least 4 short`,
        );
      const v2 = findViolationsDeep(
        v.candidates.map((c) => ({ name: c.name, rationale: c.rationale })),
      );
      if (v2.length) problems.push(describeViolations(v2));
      return problems;
    },
    fixture: () => fixtureBrandNames(project),
  });
  return out.candidates.map((c) => finalizeCandidate(c, { avoid }));
}

/**
 * Tagline, voice, palette and fonts for the chosen name. Contrast is enforced in code after
 * generation (colours adjusted, changes reported) and fonts are resolved against the verified
 * Shopify library list.
 */
export async function generateBrandDetails(project: ProjectRecord, name: string) {
  const { tone } = styleOf(project);
  const out = await callStructured({
    task: "generateBrandDetails",
    projectId: project.id,
    system: `${BRAND_DETAILS_SYSTEM}\n\n${globalRules(styleOf(project))}`,
    content: [
      {
        type: "text",
        text: `${productFacts(project, { includeAnalysis: true })}\n\nBrand name: ${name}\nRequested tone: ${tone} (${toneGuide(tone)})\n\nCreate the brand kit.`,
      },
    ],
    schema: DetailsOutput,
    toolName: "record_brand_kit",
    toolDescription: "Record the tagline, voice guide, palette and font pairing.",
    maxTokens: 4000,
    effort: "medium",
    check: (v) => {
      // The voice guide is internal (it may name things to avoid); only the tagline is public.
      const found = findViolationsDeep({ tagline: v.tagline });
      return found.length ? [describeViolations(found)] : [];
    },
    fixture: () => fixtureBrandDetails(project),
  });
  const { palette, changes } = enforcePalette(out.palette);
  const details: Pick<BrandKit, "tagline" | "voice" | "palette" | "fonts"> = {
    tagline: out.tagline.trim(),
    voice: out.voice,
    palette,
    fonts: { heading: resolveFont(out.fonts.heading), body: resolveFont(out.fonts.body) },
  };
  return { details, contrastChanges: changes };
}
