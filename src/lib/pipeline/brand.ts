import "server-only";
import { generateBrandDetails, generateBrandNames } from "@/lib/ai/brand";
import { finalizeCandidate } from "@/lib/brand/names";
import { renderLogo, type FontLoader } from "@/lib/brand/logo";
import { getProject, updateProject, type ProjectRecord } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import type { JobContext } from "@/lib/jobs/runner";
import { BrandKit } from "@/lib/schemas";
import { runAnalyze } from "./analyze";

type Range = [number, number];
const span =
  (range: Range = [0, 100]) =>
  (f: number) =>
    range[0] + (range[1] - range[0]) * f;

const emptyKit = () => BrandKit.parse({});

/** The brand step needs the reviewed product analysis; run it first when it's missing. */
async function withAnalysis(ctx: JobContext, at: (f: number) => number): Promise<ProjectRecord> {
  let project = await getProject(ctx.projectId);
  if (!project.analysis) {
    await runAnalyze(ctx, { range: [at(0), at(0.3)] });
    project = await getProject(ctx.projectId);
  }
  return project;
}

function merchantName(project: ProjectRecord) {
  return project.inputs.context.brandName?.trim() || null;
}

/** Step 3a: six name candidates (plus the merchant's own name, if they gave one). */
export async function runBrandNames(ctx: JobContext, opts: { range?: Range } = {}) {
  const at = span(opts.range);
  const project = await withAnalysis(ctx, at);
  await ctx.progress("brand", at(0.35), "Brainstorming brand names");
  const generated = await generateBrandNames(project);
  const own = merchantName(project);
  const avoid = project.extractions.map((e) => e.brand).filter((b): b is string => Boolean(b));
  const candidates = own
    ? [
        finalizeCandidate({ name: own, rationale: "Your existing brand name." }, { avoid }),
        ...generated.filter((c) => c.name.toLowerCase() !== own.toLowerCase()),
      ]
    : generated;
  const current = (await getProject(ctx.projectId)).brandKit ?? emptyKit();
  await updateProject(ctx.projectId, {
    brandKit: { ...current, nameCandidates: candidates },
  });
  await ctx.progress("brand", at(1), `${candidates.length} name ideas ready`, {
    names: candidates.map((c) => c.name),
  });
  return { names: candidates.map((c) => c.name) };
}

/**
 * Step 3b: for the chosen name, tagline + voice + palette (contrast enforced in code) + fonts
 * (resolved against Shopify's library) + the SVG/PNG wordmark.
 */
export async function runBrandDetails(
  ctx: JobContext,
  opts: { name?: string | null; range?: Range; loadFont?: FontLoader } = {},
) {
  const at = span(opts.range);
  let project = await withAnalysis(ctx, at);
  let kit = project.brandKit ?? emptyKit();
  let name =
    opts.name?.trim() || kit.selectedName || merchantName(project) || kit.nameCandidates[0]?.name;
  if (!name) {
    await runBrandNames(ctx, { range: [at(0.3), at(0.5)] });
    project = await getProject(ctx.projectId);
    kit = project.brandKit ?? emptyKit();
    name = kit.nameCandidates[0]?.name;
  }
  if (!name) throw new UserFacingError("Pick or type a brand name first.");
  if (name.length > 60) throw new UserFacingError("Brand names must be 60 characters or fewer.");

  await ctx.progress("brand", at(0.55), `Designing the brand kit for ${name}`);
  const { details, contrastChanges } = await generateBrandDetails(project, name);
  await ctx.progress("brand", at(0.8), "Drawing the wordmark logo");
  const logo = await renderLogo(
    ctx.projectId,
    { selectedName: name, palette: details.palette, fonts: details.fonts },
    { loadFont: opts.loadFont },
  );
  const latest = (await getProject(ctx.projectId)).brandKit ?? kit;
  const candidates = latest.nameCandidates.some((c) => c.name === name)
    ? latest.nameCandidates
    : [...latest.nameCandidates, finalizeCandidate({ name, rationale: "Your own choice." })];
  const next: BrandKit = {
    ...latest,
    nameCandidates: candidates,
    selectedName: name,
    ...details,
    logoSvg: logo?.logoSvg ?? null,
    logoPngPath: logo?.logoPngPath ?? null,
    logoOutlined: logo?.logoOutlined ?? false,
  };
  await updateProject(ctx.projectId, {
    brandKit: next,
    name: project.name === "Untitled store" ? name : undefined,
    changed: ["brand"],
    steps: { brand: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  await ctx.progress("brand", at(1), "Brand kit ready", { name, tagline: next.tagline });
  return {
    name,
    tagline: next.tagline,
    contrastAdjusted: contrastChanges,
    fonts: {
      heading: next.fonts?.heading.family,
      body: next.fonts?.body.family,
    },
    logoOutlined: next.logoOutlined,
  };
}

/** Pipeline stage: names (if none yet) then details for the selected/merchant/first name. */
export async function runBrand(
  ctx: JobContext,
  opts: { range?: Range; loadFont?: FontLoader } = {},
) {
  const at = span(opts.range);
  const project = await getProject(ctx.projectId);
  if (!project.brandKit?.nameCandidates.length) {
    await runBrandNames(ctx, { range: [at(0), at(0.4)] });
  }
  return runBrandDetails(ctx, { range: [at(0.4), at(1)], loadFont: opts.loadFont });
}
