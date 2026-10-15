import "server-only";
import { runPreflight } from "@/lib/export/preflight";
import type { ImageAsset } from "@/lib/schemas";
import { prisma } from "./client";
import type { ProjectRecord } from "./projects";

/** Product handles used by the merchant's other projects (for the "handle unique" check). */
async function otherHandles(projectId: string): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { id: { not: projectId }, listing: { not: null } },
    select: { listing: true },
  });
  const out: string[] = [];
  for (const r of rows) {
    try {
      const h = (JSON.parse(r.listing!) as { handle?: unknown }).handle;
      if (typeof h === "string") out.push(h);
    } catch {
      // ignore unreadable rows
    }
  }
  return out;
}

export async function projectPreflight(project: ProjectRecord, assets: ImageAsset[]) {
  return runPreflight({
    listing: project.listing,
    content: project.content,
    brand: project.brandKit,
    analysis: project.analysis,
    assets: assets.filter((a) => !a.discarded),
    otherHandles: await otherHandles(project.id),
  });
}
