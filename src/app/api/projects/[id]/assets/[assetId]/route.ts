import { readFile, rm } from "node:fs/promises";
import { HttpError, json, route } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { normalizePositions } from "@/lib/db/assets";
import { updateProject } from "@/lib/db/projects";
import { assertSafeId, fromDataRelative } from "@/lib/security/paths";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

async function findAsset(id: string, assetId: string) {
  assertSafeId(id);
  assertSafeId(assetId);
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projectId: id } });
  if (!asset) throw new HttpError(404, "Image not found");
  return asset;
}

/** Serve an image file. ?v=processed returns the processed WebP when available. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id, assetId } = await params;
  const asset = await findAsset(id, assetId);
  const variant = new URL(req.url).searchParams.get("v");
  const useProcessed = variant === "processed" && asset.processedPath;
  const rel = useProcessed ? asset.processedPath! : asset.originalPath;
  const data = await readFile(fromDataRelative(rel));
  const type = useProcessed ? "image/webp" : asset.mimeType;
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": "inline",
    },
  });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id, assetId } = await params;
  const asset = await findAsset(id, assetId);
  await prisma.asset.delete({ where: { id: asset.id } });
  for (const rel of [
    asset.originalPath,
    asset.processedPath,
    asset.processedPath?.replace(/\.webp$/, ".jpg"),
  ]) {
    if (rel) await rm(fromDataRelative(rel), { force: true });
  }
  await normalizePositions(id);
  await updateProject(id, { changed: ["input", "images"] });
  return json({ ok: true });
});
