import { HttpError, json, rateLimit, route } from "@/lib/api";
import { env } from "@/lib/config";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { ingestImage, MAX_IMAGES_PER_PROJECT } from "@/lib/images/ingest";
import type { ImageAsset } from "@/lib/schemas";
import { POLICIES } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Multipart upload of product photos (field name "files"). Validates by magic bytes. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  rateLimit(req, "upload", POLICIES.upload);
  await getProject(id);
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes * MAX_IMAGES_PER_PROJECT + 1024 * 1024) {
    throw new HttpError(413, "Upload too large");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected multipart/form-data with image files");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (!files.length) throw new HttpError(400, "No files received");
  if (files.length > MAX_IMAGES_PER_PROJECT) {
    throw new HttpError(400, `Upload at most ${MAX_IMAGES_PER_PROJECT} images at a time`);
  }
  const assets: ImageAsset[] = [];
  const errors: { file: string; error: string }[] = [];
  for (const file of files) {
    const name = file.name.slice(0, 120) || "image";
    if (file.size > maxBytes) {
      errors.push({ file: name, error: `Larger than ${env().MAX_UPLOAD_MB} MB` });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      assets.push(await ingestImage(id, buf, { origin: "upload", fileName: name }));
    } catch (err) {
      errors.push({
        file: name,
        error: err instanceof UserFacingError ? err.message : "Could not read this image",
      });
    }
  }
  if (assets.length) {
    await updateProject(id, {
      changed: ["input"],
      steps: { input: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
    });
  }
  return json({ assets, errors }, assets.length ? 201 : 400);
});
