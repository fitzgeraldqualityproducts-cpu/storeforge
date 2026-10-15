import "server-only";
import { runAnalyze, scrapeFallbackFor } from "@/lib/pipeline/analyze";
import { runBrandDetails, runBrandNames } from "@/lib/pipeline/brand";
import { runExtract } from "@/lib/pipeline/extract";
import { runImages } from "@/lib/pipeline/images";
import { runPipeline, visionFor } from "@/lib/pipeline/run";
import { registerHandler } from "./runner";

/** Registers every job type's handler. Called once when the runner starts. */
export function registerAllHandlers() {
  registerHandler("extract", async (ctx) => {
    const extractions = await runExtract(ctx, {
      force: Boolean(ctx.payload.force),
      llmFallback: scrapeFallbackFor(ctx.projectId),
    });
    return {
      sources: extractions.map((e) => ({
        url: e.url,
        title: e.title,
        fetchMethod: e.fetchMethod,
        warnings: e.warnings.map((w) => w.code),
      })),
    };
  });
  registerHandler("analyze", (ctx) => runAnalyze(ctx));
  registerHandler("images", (ctx) =>
    runImages(ctx, { options: ctx.payload, vision: visionFor(ctx.projectId) }),
  );
  registerHandler("brand_names", (ctx) => runBrandNames(ctx));
  registerHandler("brand_details", (ctx) =>
    runBrandDetails(ctx, {
      name: typeof ctx.payload.name === "string" ? ctx.payload.name : null,
    }),
  );
  registerHandler("pipeline", (ctx) =>
    runPipeline(ctx, { forceScrape: Boolean(ctx.payload.forceScrape) }),
  );
}
