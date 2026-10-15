import { z } from "zod";
import { HttpError } from "@/lib/api";
import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("names") }),
  z.object({ action: z.literal("details"), name: z.string().trim().min(1).max(60).optional() }),
]);

/**
 * Start brand generation. `names` brainstorms 6 candidates; `details` builds the tagline, voice,
 * palette, fonts and logo for `name` (or the selected name).
 */
export const POST = jobRoute({
  body: Body,
  type: (b) => (b.action === "names" ? "brand_names" : "brand_details"),
  check: (project, b) => {
    if (b.action === "details" && !b.name && !project.brandKit?.selectedName) {
      const any = project.brandKit?.nameCandidates.length || project.inputs.context.brandName;
      if (!any) throw new HttpError(422, "Generate name ideas or type a brand name first.");
    }
  },
});
