import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/db/client";
import { hydrateAsset, listAssets } from "@/lib/db/assets";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { backgroundRemovalConfigured, removeBackground } from "@/lib/images/background";
import { dedupe } from "@/lib/images/dedupe";
import { perceptualHash } from "@/lib/images/hash";
import { processImage } from "@/lib/images/process";
import { DISCARD_BELOW, scoreQuality } from "@/lib/images/quality";
import type { JobContext } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import { mapLimit } from "@/lib/retry";
import {
  IMAGE_ROLES,
  ImageProcessOptions,
  type ImageAsset,
  type ImageFlag,
  type ImageVisionResult,
} from "@/lib/schemas";
import { fromDataRelative, projectDir, toDataRelative } from "@/lib/security/paths";

/** Image processing is CPU-heavy; keep it modest so the server stays responsive. */
export const PROCESS_CONCURRENCY = 2;
/** Never auto-discard below this many remaining images. */
const MIN_KEEP = 3;
const VISION_CODES = new Set<ImageFlag["code"]>(["watermark", "text_overlay", "not_product"]);

/** Vision describer injected by the AI layer (alt text, role, watermark/text/product checks). */
export type VisionDescriber = (
  assets: ImageAsset[],
  ctx: { title: string | null },
) => Promise<ImageVisionResult[]>;

export interface ImagesOptions {
  options?: Partial<ImageProcessOptions>;
  vision?: VisionDescriber | null;
  range?: [number, number];
}

function fallbackAlt(title: string, role: string | null, n: number) {
  const view = role === "hero" ? "" : role ? ` – ${role} view` : n > 1 ? ` – view ${n}` : "";
  return `${title}${view}`.slice(0, 125);
}

/**
 * Full image pipeline: hash → dedupe → quality score (+ vision flags) → discard weak images →
 * order by role → optional background removal → process to WebP/JPEG → alt text.
 */
export async function runImages(ctx: JobContext, opts: ImagesOptions = {}) {
  const [lo, hi] = opts.range ?? [0, 100];
  const at = (f: number) => lo + (hi - lo) * f;
  const project = await getProject(ctx.projectId);
  const options = ImageProcessOptions.parse({ ...project.imageOptions, ...opts.options });
  if (options.removeBackground && !backgroundRemovalConfigured()) {
    throw new UserFacingError(
      "Background removal isn't configured on this server. Turn it off and retry.",
    );
  }
  const brandBg = project.brandKit?.palette?.background ?? "#ffffff";
  const background = options.background === "brand" ? brandBg : "#ffffff";

  // Previously auto-discarded duplicates/low-quality images are reconsidered on every run;
  // images the user deleted are gone, and user-discarded ones keep their reason "user".
  await prisma.asset.updateMany({
    where: { projectId: ctx.projectId, discarded: true, NOT: { discardReason: "user" } },
    data: { discarded: false, discardReason: null },
  });
  let assets = await listAssets(ctx.projectId);
  if (!assets.length) {
    throw new UserFacingError(
      "There are no images yet. Upload photos or add a product URL in Step 1.",
    );
  }
  const title =
    project.listing?.title ||
    project.analysis?.productName ||
    project.extractions[0]?.title ||
    project.name;

  // 1. Perceptual hashes.
  await ctx.progress("images", at(0.05), `Fingerprinting ${assets.length} images`);
  const originals = new Map<string, Buffer>();
  for (const a of assets) originals.set(a.id, await readFile(fromDataRelative(a.originalPath)));
  for (const a of assets) {
    if (!a.phash) {
      a.phash = await perceptualHash(originals.get(a.id)!);
      await prisma.asset.update({ where: { id: a.id }, data: { phash: a.phash } });
    }
  }

  // 2. Dedupe (keep highest resolution; uploads win ties over scraped).
  const { duplicates } = dedupe(
    assets.map((a) => ({
      id: a.id,
      phash: a.phash!,
      width: a.width,
      height: a.height,
      rank: (a.origin === "upload" ? 0 : 1000) + a.position,
    })),
  );
  for (const [dup, keptId] of duplicates) {
    const kept = assets.findIndex((a) => a.id === keptId) + 1;
    await prisma.asset.update({
      where: { id: dup },
      data: { discarded: true, discardReason: `Duplicate of image ${kept}` },
    });
  }
  if (duplicates.size) {
    await ctx.progress(
      "images",
      at(0.15),
      `Removed ${duplicates.size} duplicate${duplicates.size === 1 ? "" : "s"}`,
    );
  }
  assets = assets.filter((a) => !duplicates.has(a.id));

  // 3. Vision (alt text, role, watermark/text overlay) when the AI layer is available.
  let vision = new Map<string, ImageVisionResult>();
  if (opts.vision) {
    await ctx.progress("images", at(0.2), "Describing images and writing alt text");
    try {
      const results = await opts.vision(assets, { title });
      vision = new Map(results.map((r) => [r.imageId, r]));
    } catch (err) {
      log.warn("images.vision_failed", { projectId: ctx.projectId, error: err });
      await ctx.progress("images", at(0.25), "Image description unavailable; using basic alt text");
    }
  }

  // 4. Quality score with vision flags.
  await ctx.progress("images", at(0.3), "Scoring image quality");
  const scored = await mapLimit(assets, PROCESS_CONCURRENCY, async (a) => {
    const v = vision.get(a.id);
    const prior = new Set(a.flags.map((f) => f.code));
    const q = await scoreQuality(originals.get(a.id)!, {
      watermark: v ? v.hasWatermark : prior.has("watermark"),
      textOverlay: v ? v.hasTextOverlay : prior.has("text_overlay"),
      notProduct: v ? !v.isProductVisible : prior.has("not_product"),
    });
    const keep = a.flags.filter(
      (f) => f.code === "third_party_source" || f.code === "background_removed",
    );
    const flags = [...keep, ...q.flags];
    const role = v?.role ?? a.role;
    const altText = v?.altText?.trim() || a.altText;
    return { asset: a, score: q.score, note: q.note, flags, role, altText };
  });

  // 5. Discard weak images, but always keep at least MIN_KEEP (or all, if fewer).
  const byScore = [...scored].sort((x, y) => y.score - x.score);
  const weak = byScore.filter((s, i) => s.score < DISCARD_BELOW && i >= MIN_KEEP);
  for (const w of weak) {
    await prisma.asset.update({
      where: { id: w.asset.id },
      data: {
        discarded: true,
        discardReason: `Low quality (${w.score}/100): ${w.note}`,
        qualityScore: w.score,
        qualityNote: w.note,
        flags: JSON.stringify(w.flags),
      },
    });
  }
  const weakIds = new Set(weak.map((w) => w.asset.id));
  const active = scored.filter((s) => !weakIds.has(s.asset.id));

  // 6. Order: user-chosen hero stays first when it has no role; otherwise hero → angle →
  // lifestyle → detail → infographic, ties by quality then previous position.
  const roleRank = (r: string | null) =>
    r ? IMAGE_ROLES.indexOf(r as (typeof IMAGE_ROLES)[number]) : 2.5;
  const manualHero = active.find((s) => s.asset.isHero && !s.role);
  const ordered = [...active].sort((x, y) => {
    if (manualHero) {
      if (x === manualHero) return -1;
      if (y === manualHero) return 1;
    }
    const xr = x.flags.some((f) => VISION_CODES.has(f.code)) ? 1 : 0;
    const yr = y.flags.some((f) => VISION_CODES.has(f.code)) ? 1 : 0;
    return (
      roleRank(x.role) - roleRank(y.role) ||
      xr - yr ||
      y.score - x.score ||
      x.asset.position - y.asset.position
    );
  });
  // A text-overlay or watermarked image should never be the hero if a clean one exists.
  if (!manualHero) {
    const cleanIdx = ordered.findIndex((s) => !s.flags.some((f) => VISION_CODES.has(f.code)));
    if (cleanIdx > 0) ordered.unshift(...ordered.splice(cleanIdx, 1));
  }

  // 7. Process.
  const outDir = projectDir(ctx.projectId, "processed");
  await mkdir(outDir, { recursive: true });
  let done = 0;
  await mapLimit(ordered, PROCESS_CONCURRENCY, async (s, i) => {
    let source = originals.get(s.asset.id)!;
    let flags = s.flags;
    if (options.removeBackground) {
      source = await removeBackground(source, s.asset.mimeType);
      if (!flags.some((f) => f.code === "background_removed")) {
        flags = [
          ...flags,
          {
            code: "background_removed",
            message: "Background removed automatically; check the edges.",
          },
        ];
      }
    } else {
      flags = flags.filter((f) => f.code !== "background_removed");
    }
    const out = await processImage(source, { squarePad: options.squarePad, background });
    const digest = createHash("sha256").update(out.webp).digest("hex").slice(0, 10);
    const base = projectDir(ctx.projectId, "processed", `${s.asset.id}-${digest}`);
    await writeFile(`${base}.webp`, out.webp);
    await writeFile(`${base}.jpg`, out.jpeg);
    if (s.asset.processedPath && s.asset.processedPath !== toDataRelative(`${base}.webp`)) {
      await rm(fromDataRelative(s.asset.processedPath), { force: true });
      await rm(fromDataRelative(s.asset.processedPath.replace(/\.webp$/, ".jpg")), { force: true });
    }
    await prisma.asset.update({
      where: { id: s.asset.id },
      data: {
        processedPath: toDataRelative(`${base}.webp`),
        qualityScore: s.score,
        qualityNote: s.note,
        flags: JSON.stringify(flags),
        role: s.role,
        altText: (s.altText || fallbackAlt(title, s.role, i + 1)).slice(0, 125),
        position: i,
        isHero: i === 0,
      },
    });
    done++;
    await ctx.progress(
      "images",
      at(0.35 + 0.6 * (done / ordered.length)),
      `Processed ${done} of ${ordered.length}`,
    );
  });

  await updateProject(ctx.projectId, {
    imageOptions: options,
    changed: ["images"],
    steps: { images: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  const final = (
    await prisma.asset.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: "asc" },
    })
  ).map(hydrateAsset);
  const kept = final.filter((a) => !a.discarded);
  await ctx.progress("images", at(1), `${kept.length} images ready`, { count: kept.length });
  return {
    kept: kept.length,
    duplicates: duplicates.size,
    lowQuality: weak.length,
    warnings:
      kept.length < 3
        ? [
            `Only ${kept.length} usable image${kept.length === 1 ? "" : "s"}; Shopify listings convert better with 3 or more.`,
          ]
        : [],
  };
}
