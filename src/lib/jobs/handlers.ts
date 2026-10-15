import "server-only";
import { runExtract } from "@/lib/pipeline/extract";
import { runImages } from "@/lib/pipeline/images";
import { registerHandler } from "./runner";

/** Registers every job type's handler. Called once when the runner starts. */
export function registerAllHandlers() {
  registerHandler("extract", async (ctx) => {
    const extractions = await runExtract(ctx, { force: Boolean(ctx.payload.force) });
    return {
      sources: extractions.map((e) => ({
        url: e.url,
        title: e.title,
        fetchMethod: e.fetchMethod,
        warnings: e.warnings.map((w) => w.code),
      })),
    };
  });
  registerHandler("images", async (ctx) => runImages(ctx, { options: ctx.payload }));
}
