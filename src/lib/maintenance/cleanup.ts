import "server-only";
import { rm } from "node:fs/promises";
import { dataDir, env } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { log } from "@/lib/log";
import { projectDir, safeJoin } from "@/lib/security/paths";

const DAY = 24 * 60 * 60 * 1000;

/** Delete projects (DB rows + files) not updated in DATA_RETENTION_DAYS, and stale scrape cache. */
export async function cleanupOldData(now = new Date()) {
  const cutoff = new Date(now.getTime() - env().DATA_RETENTION_DAYS * DAY);
  const old = await prisma.project.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const p of old) {
    const exports = await prisma.exportRecord.findMany({
      where: { projectId: p.id },
      select: { artifactPath: true },
    });
    await prisma.project.delete({ where: { id: p.id } });
    await rm(projectDir(p.id), { recursive: true, force: true });
    for (const e of exports) {
      if (e.artifactPath) await rm(safeJoin(dataDir(), e.artifactPath), { force: true });
    }
  }
  const cache = await prisma.scrapeCache.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  if (old.length || cache.count) {
    log.info("cleanup.done", { projectsDeleted: old.length, scrapeCacheDeleted: cache.count });
  }
  return { projectsDeleted: old.length };
}

export function scheduleCleanup() {
  const run = () => cleanupOldData().catch((error) => log.error("cleanup.failed", { error }));
  void run();
  const t = setInterval(run, DAY);
  t.unref?.();
}
