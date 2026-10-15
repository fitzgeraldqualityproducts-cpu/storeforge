import "server-only";
import type { Asset as AssetRow } from "@/generated/prisma/client";
import { z } from "zod";
import { ImageAsset, ImageFlag, ImageRole } from "@/lib/schemas";
import { prisma } from "./client";

export function hydrateAsset(row: AssetRow): ImageAsset {
  let flags: ImageFlag[] = [];
  try {
    const p = z.array(ImageFlag).safeParse(JSON.parse(row.flags));
    if (p.success) flags = p.data;
  } catch {
    flags = [];
  }
  const role = ImageRole.safeParse(row.role);
  return {
    id: row.id,
    origin: row.origin === "scraped" ? "scraped" : "upload",
    sourceUrl: row.sourceUrl,
    originalPath: row.originalPath,
    processedPath: row.processedPath,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    phash: row.phash,
    qualityScore: row.qualityScore,
    qualityNote: row.qualityNote,
    flags,
    altText: row.altText,
    position: row.position,
    variantKey: row.variantKey,
    isHero: row.isHero,
    discarded: row.discarded,
    discardReason: row.discardReason,
    role: role.success ? role.data : null,
  };
}

export async function listAssets(projectId: string, opts: { includeDiscarded?: boolean } = {}) {
  const rows = await prisma.asset.findMany({
    where: { projectId, ...(opts.includeDiscarded ? {} : { discarded: false }) },
    orderBy: [{ discarded: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(hydrateAsset);
}

/** Active (non-discarded) assets in display order, hero first. */
export async function orderedActiveAssets(projectId: string) {
  const assets = await listAssets(projectId);
  return [...assets].sort((a, b) => Number(b.isHero) - Number(a.isHero) || a.position - b.position);
}

export async function normalizePositions(projectId: string) {
  const assets = await orderedActiveAssets(projectId);
  await prisma.$transaction(
    assets.map((a, i) =>
      prisma.asset.update({ where: { id: a.id }, data: { position: i, isHero: i === 0 } }),
    ),
  );
}
