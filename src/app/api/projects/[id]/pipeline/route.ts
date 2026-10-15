import { z } from "zod";
import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

/** Run every step in order: extract → images → analyze → brand → listing → content. */
export const POST = jobRoute({
  type: "pipeline",
  body: z.object({ forceScrape: z.boolean().default(false) }),
});
