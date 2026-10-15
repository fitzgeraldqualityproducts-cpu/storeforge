import { z } from "zod";
import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

/** Generate (or regenerate) the store content: homepage, pages, policies, collections, menus. */
export const POST = jobRoute({
  type: "content",
  body: z.object({ instruction: z.string().trim().max(1000).optional() }),
});
