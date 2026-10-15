import { jobRoute } from "@/lib/jobs/start";
import { ImageProcessOptions } from "@/lib/schemas";
import { HttpError } from "@/lib/api";
import { backgroundRemovalConfigured } from "@/lib/images/background";

export const dynamic = "force-dynamic";

/** Run the image pipeline (dedupe, score, order, process, alt text). */
export const POST = jobRoute({
  type: "images",
  body: ImageProcessOptions.partial(),
  check: (_project, body) => {
    if (body.removeBackground && !backgroundRemovalConfigured()) {
      throw new HttpError(422, "Background removal isn't configured on this server.");
    }
  },
});
