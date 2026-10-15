import { jobRoute } from "@/lib/jobs/start";

export const dynamic = "force-dynamic";

/** Run the product analysis + risk review (re-reads the source first if it hasn't been read). */
export const POST = jobRoute({ type: "analyze" });
