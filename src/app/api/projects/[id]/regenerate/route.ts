import { HttpError } from "@/lib/api";
import { jobRoute } from "@/lib/jobs/start";
import { LISTING_FIELDS } from "@/lib/pipeline/regenerate";
import { RegenerateRequest } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/**
 * Regenerate one section, or rewrite one field ("regenerate" / "shorten" / "change_tone").
 * Runs as a job so progress streams over the project's event stream.
 */
export const POST = jobRoute({
  type: "regenerate",
  body: RegenerateRequest,
  check: (project, body) => {
    if (body.section === "listing_field") {
      if (!body.field || !(body.field in LISTING_FIELDS))
        throw new HttpError(400, `Unknown listing field "${body.field ?? ""}"`);
      if (!project.listing) throw new HttpError(422, "Generate the product listing first.");
      if (body.operation === "change_tone" && !body.tone)
        throw new HttpError(400, "Pick a tone to change to.");
    }
  },
});
