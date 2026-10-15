import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { assertSafeId, fromDataRelative } from "@/lib/security/paths";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Download an export bundle ZIP. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  assertSafeId(id);
  const row = await prisma.exportRecord.findUnique({ where: { id } });
  if (!row || row.type !== "bundle" || !row.artifactPath)
    throw new HttpError(404, "Export not found");
  const file = fromDataRelative(row.artifactPath);
  const info = await stat(file).catch(() => null);
  if (!info) throw new HttpError(410, "This export's files were removed. Export again.");
  const name = row.artifactPath
    .split("/")
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
