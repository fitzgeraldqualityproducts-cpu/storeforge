import "server-only";
import { listProjectJobs } from "@/lib/jobs/runner";
import { listAssets } from "./assets";
import { prisma } from "./client";
import { getProject } from "./projects";
import { listExports } from "./exports";
import { projectPreflight } from "./preflight";

/** Everything the wizard needs in one payload. */
export async function getProjectView(id: string) {
  const project = await getProject(id);
  const [assets, jobs, exports, aiStats] = await Promise.all([
    listAssets(id, { includeDiscarded: true }),
    listProjectJobs(id, 40),
    listExports(id),
    prisma.aiCall.aggregate({
      where: { projectId: id },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
    }),
  ]);
  return {
    project,
    assets,
    preflight: await projectPreflight(project, assets),
    jobs,
    exports,
    aiUsage: {
      calls: aiStats._count,
      inputTokens: aiStats._sum.inputTokens ?? 0,
      outputTokens: aiStats._sum.outputTokens ?? 0,
    },
  };
}
export type ProjectView = Awaited<ReturnType<typeof getProjectView>>;
