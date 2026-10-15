import { rm } from "node:fs/promises";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { listAssets } from "@/lib/db/assets";
import { prisma } from "@/lib/db/client";
import { getProject, updateProject } from "@/lib/db/projects";
import { ImagePatch, ImageProcessOptions } from "@/lib/schemas";
import { assertSafeId, fromDataRelative } from "@/lib/security/paths";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const Body = ImagePatch.extend({ options: ImageProcessOptions.partial().optional() });

/**
 * Gallery edits: reorder, set hero, alt text, variant mapping, discard/restore, delete, and
 * processing options. Changes mark the export step stale.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  assertSafeId(id);
  const body = await parseBody(req, Body);
  const project = await getProject(id);
  const all = await listAssets(id, { includeDiscarded: true });
  const known = new Set(all.map((a) => a.id));
  const ids = [
    ...(body.order ?? []),
    ...(body.heroId ? [body.heroId] : []),
    ...(body.updates ?? []).map((u) => u.id),
    ...(body.deleteIds ?? []),
  ];
  const unknown = ids.find((x) => !known.has(x));
  if (unknown)
    throw new HttpError(404, "One of those images no longer exists. Refresh and try again.");

  const ops = [];
  for (const u of body.updates ?? []) {
    ops.push(
      prisma.asset.update({
        where: { id: u.id },
        data: {
          ...(u.altText !== undefined ? { altText: u.altText.trim() } : {}),
          ...(u.variantKey !== undefined ? { variantKey: u.variantKey || null } : {}),
          ...(u.discarded !== undefined
            ? { discarded: u.discarded, discardReason: u.discarded ? "user" : null }
            : {}),
        },
      }),
    );
  }
  for (const delId of body.deleteIds ?? []) ops.push(prisma.asset.delete({ where: { id: delId } }));
  await prisma.$transaction(ops);
  for (const a of all.filter((x) => body.deleteIds?.includes(x.id))) {
    for (const rel of [
      a.originalPath,
      a.processedPath,
      a.processedPath?.replace(/\.webp$/, ".jpg"),
    ]) {
      if (rel) await rm(fromDataRelative(rel), { force: true });
    }
  }

  // Ordering: explicit order first, then any remaining active images; hero moves to the front.
  const active = (await listAssets(id)).sort((a, b) => a.position - b.position);
  let order = body.order?.filter((x) => active.some((a) => a.id === x)) ?? [];
  order = [...order, ...active.map((a) => a.id).filter((x) => !order.includes(x))];
  const hero =
    body.heroId ?? (body.order ? order[0] : (active.find((a) => a.isHero)?.id ?? order[0]));
  if (hero && order.includes(hero)) order = [hero, ...order.filter((x) => x !== hero)];
  await prisma.$transaction([
    ...order.map((assetId, i) =>
      prisma.asset.update({ where: { id: assetId }, data: { position: i, isHero: i === 0 } }),
    ),
    prisma.asset.updateMany({ where: { projectId: id, discarded: true }, data: { isHero: false } }),
  ]);

  const options = body.options
    ? ImageProcessOptions.parse({ ...project.imageOptions, ...body.options })
    : undefined;
  const optionsChanged =
    options && JSON.stringify(options) !== JSON.stringify(project.imageOptions);
  const updated = await updateProject(id, {
    ...(options ? { imageOptions: options } : {}),
    changed: ["images"],
    // New processing options mean the processed files are out of date.
    ...(optionsChanged && project.steps.images.status === "ready"
      ? { steps: { images: { status: "stale" as const } } }
      : {}),
  });
  return json({ project: updated, assets: await listAssets(id, { includeDiscarded: true }) });
});
