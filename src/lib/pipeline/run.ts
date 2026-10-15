import "server-only";
import { describeImages } from "@/lib/ai/analyze";
import { isAiConfigured } from "@/lib/config";
import { getProject, updateProject } from "@/lib/db/projects";
import type { JobContext } from "@/lib/jobs/runner";
import { runAnalyze, scrapeFallbackFor } from "./analyze";
import { runBrand } from "./brand";
import { runListing } from "./listing";
import { runExtract } from "./extract";
import { runImages, type VisionDescriber } from "./images";

/** Alt text/roles for images the analysis didn't cover (e.g. added later), when AI is available. */
export function visionFor(projectId: string): VisionDescriber | null {
  if (!isAiConfigured()) return null;
  return async (assets, { title }) => {
    const missing = assets.filter((a) => !a.altText || !a.role);
    if (!missing.length) return [];
    return describeImages(await getProject(projectId), missing, title);
  };
}

interface Stage {
  name: string;
  weight: number;
  run: (ctx: JobContext, range: [number, number]) => Promise<unknown>;
  skip?: () => Promise<boolean>;
}

/**
 * "Generate everything": every step in order with progress mapped onto one bar.
 * extract → analyze → brand → listing → images (a later milestone appends content).
 */
export async function runPipeline(ctx: JobContext, opts: { forceScrape?: boolean } = {}) {
  const project = await getProject(ctx.projectId);
  await updateProject(ctx.projectId, { status: "generating" });
  const stages: Stage[] = [
    {
      name: "extract",
      weight: 15,
      skip: async () => project.inputs.urls.length === 0,
      run: (c, range) =>
        runExtract(c, {
          force: opts.forceScrape,
          llmFallback: scrapeFallbackFor(c.projectId),
          range,
        }),
    },
    { name: "analyze", weight: 30, run: (c, range) => runAnalyze(c, { range }) },
    { name: "brand", weight: 15, run: (c, range) => runBrand(c, { range }) },
    { name: "listing", weight: 20, run: (c, range) => runListing(c, { range }) },
    {
      name: "images",
      weight: 20,
      run: (c, range) => runImages(c, { vision: visionFor(c.projectId), range }),
    },
  ];
  const total = stages.reduce((s, x) => s + x.weight, 0);
  let done = 0;
  const results: Record<string, unknown> = {};
  try {
    for (const stage of stages) {
      const range: [number, number] = [(done / total) * 100, ((done + stage.weight) / total) * 100];
      if (!(await stage.skip?.())) results[stage.name] = await stage.run(ctx, range);
      done += stage.weight;
    }
  } finally {
    const p = await getProject(ctx.projectId);
    const allReady = (["analysis", "brand", "listing", "images"] as const).every(
      (s) => p.steps[s].status === "ready",
    );
    await updateProject(ctx.projectId, { status: allReady ? "ready" : "draft" });
  }
  return results;
}
