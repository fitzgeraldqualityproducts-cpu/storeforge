import { z } from "zod";
import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

/** "Generate everything": run every step in order (see runPipeline). */
export const POST = jobRoute({
  type: "pipeline",
  body: z.object({ forceScrape: z.boolean().default(false) }),
});
