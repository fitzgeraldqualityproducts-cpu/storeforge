import "server-only";
import { prisma } from "@/lib/db/client";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { ingestImage, MAX_IMAGES_PER_PROJECT } from "@/lib/images/ingest";
import type { JobContext } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import type { SourceExtraction } from "@/lib/schemas";
import { defaultPolicy, scrapeUrl, type LlmFallback } from "@/lib/scrape";
import { downloadImages, selectImageCandidates } from "@/lib/scrape/images";

/** How many scraped images to keep from the primary URL (uploads always take precedence). */
export const MAX_SCRAPED_IMAGES = 10;

export interface ExtractOptions {
  force?: boolean;
  llmFallback?: LlmFallback | null;
  /** Map overall progress into a sub-range when run inside the pipeline. */
  range?: [number, number];
}

/**
 * Scrape every project URL, store the extractions, and download the primary URL's image
 * candidates as project assets (marked as third-party).
 */
export async function runExtract(
  ctx: JobContext,
  opts: ExtractOptions = {},
): Promise<SourceExtraction[]> {
  const [lo, hi] = opts.range ?? [0, 100];
  const at = (f: number) => lo + (hi - lo) * f;
  const project = await getProject(ctx.projectId);
  const urls = project.inputs.urls;
  if (!urls.length) {
    await ctx.progress("extract", at(1), "No URLs to read; using your photos only");
    await updateProject(ctx.projectId, { extractions: [] });
    return [];
  }
  const policy = defaultPolicy();
  const extractions: SourceExtraction[] = [];
  for (const [i, url] of urls.entries()) {
    await ctx.progress("extract", at((i / urls.length) * 0.7), `Reading ${new URL(url).hostname}`);
    const result = await scrapeUrl(url, {
      force: opts.force,
      policy,
      llmFallback: opts.llmFallback ?? null,
      onProgress: (m) => void ctx.progress("extract", at((i / urls.length) * 0.7), m),
    });
    extractions.push(result);
    await ctx.progress(
      "extract",
      at(((i + 1) / urls.length) * 0.7),
      result.title
        ? `Found “${result.title.slice(0, 60)}”`
        : (result.warnings[0]?.message ?? "Done"),
      { url, title: result.title, price: result.price, warnings: result.warnings },
    );
  }
  await updateProject(ctx.projectId, { extractions, changed: ["input"] });

  // Download images from the primary source only (references are for positioning).
  const primary = extractions[0];
  if (primary && primary.images.length) {
    const existing = await prisma.asset.findMany({
      where: { projectId: ctx.projectId },
      select: { sourceUrl: true, discarded: true },
    });
    const have = new Set(existing.map((e) => e.sourceUrl).filter(Boolean));
    const active = existing.filter((e) => !e.discarded).length;
    const room = Math.min(MAX_SCRAPED_IMAGES, MAX_IMAGES_PER_PROJECT - active);
    const candidates = selectImageCandidates(primary.images, 15).filter((c) => !have.has(c.url));
    if (room > 0 && candidates.length) {
      await ctx.progress(
        "extract",
        at(0.75),
        `Downloading up to ${Math.min(room, candidates.length)} product images`,
      );
      const { images } = await downloadImages(
        candidates
          .slice(0, room + 4)
          .map((c) => ({
            url: c.url,
            fallbackUrl: c.originalUrl !== c.url ? c.originalUrl : undefined,
          })),
        policy,
      );
      let added = 0;
      for (const img of images) {
        if (added >= room) break;
        try {
          await ingestImage(ctx.projectId, img.buffer, { origin: "scraped", sourceUrl: img.url });
          added++;
        } catch (err) {
          if (!(err instanceof UserFacingError))
            log.warn("extract.ingest_failed", { url: img.url, error: err });
        }
      }
      await ctx.progress(
        "extract",
        at(1),
        `Added ${added} image${added === 1 ? "" : "s"} from the product page`,
      );
    }
  }
  return extractions;
}
