import { z } from "zod";
import { jobRoute } from "@/lib/jobs/start";
import { POLICIES } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Start scraping the project's URLs (static fetch first, browser fallback). */
export const POST = jobRoute({
  type: "extract",
  bucket: "scrape",
  policy: POLICIES.scrape,
  body: z.object({ force: z.boolean().default(false) }),
});
