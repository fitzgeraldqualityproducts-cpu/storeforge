import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { assertSafeId, fromDataRelative, safeJoin } from "@/lib/security/paths";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ exportId: string; file: string }> };

const FILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{1,3}\.webp$/;

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * "Public URL mode" image hosting so Shopify's CSV importer can fetch product images. Only the
 * images of one export, only with its token, and only for 24 hours after the export.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { exportId, file } = await params;
  assertSafeId(exportId);
  if (!FILE_RE.test(file)) throw new HttpError(404, "Not found");
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const row = await prisma.exportRecord.findUnique({ where: { id: exportId } });
  if (
    !row?.publicToken ||
    !row.publicExpiresAt ||
    !row.artifactPath ||
    !token ||
    !sameToken(token, row.publicToken)
  )
    throw new HttpError(404, "Not found");
  if (row.publicExpiresAt.getTime() < Date.now())
    throw new HttpError(410, "This link has expired.");
  const dir = path.dirname(fromDataRelative(row.artifactPath));
  const data = await readFile(safeJoin(dir, "images", file)).catch(() => null);
  if (!data) throw new HttpError(404, "Not found");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
});
