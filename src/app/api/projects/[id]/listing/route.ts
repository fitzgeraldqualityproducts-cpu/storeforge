import { z } from "zod";
import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

/** Generate (or regenerate) the product listing: pricing, copy, originality check, variants, SEO. */
export const POST = jobRoute({
  type: "listing",
  body: z.object({ instruction: z.string().trim().max(1000).optional() }),
});
