import { jobRoute } from "@/lib/jobs/start";
import { BundleOptions } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Build the export ZIP (CSV, pages, theme JSON, brand files, validation report). */
export const POST = jobRoute({ type: "export_bundle", body: BundleOptions });
