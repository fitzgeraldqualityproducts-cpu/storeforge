import { HttpError, route } from "@/lib/api";
import { orderedActiveAssets } from "@/lib/db/assets";
import { getProject } from "@/lib/db/projects";
import { buildProductCsv } from "@/lib/export/csv";
import { exportImageName } from "@/lib/export/bundle";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The product CSV as text (no image links) for the "copy" button in the export step. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const project = await getProject(id);
  if (!project.listing) throw new HttpError(422, "Write the product listing first.");
  const format = new URL(req.url).searchParams.get("format") === "legacy" ? "legacy" : "current";
  const assets = await orderedActiveAssets(id);
  const { csv } = buildProductCsv(
    project.listing,
    assets.map((a, i) => ({
      assetId: a.id,
      fileName: exportImageName(project.listing!.handle, i + 1),
      url: null,
      alt: a.altText,
      variantKey: a.variantKey,
    })),
    { format, withImages: false },
  );
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" },
  });
});
