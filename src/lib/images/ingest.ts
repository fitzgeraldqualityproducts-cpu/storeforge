import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import convertHeic from "heic-convert";
import sharp, { type Metadata } from "sharp";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { hydrateAsset } from "@/lib/db/assets";
import { UserFacingError } from "@/lib/errors";
import type { ImageFlag } from "@/lib/schemas";
import { projectDir, toDataRelative } from "@/lib/security/paths";
import {
  detectImageType,
  extensionFor,
  SCRAPE_TYPES,
  UPLOAD_TYPES,
  type DetectedImage,
} from "./magic";

export const MAX_IMAGES_PER_PROJECT = 20;
/** Hard ceiling on decoded pixels to avoid decompression bombs (~100 MP). */
export const MAX_INPUT_PIXELS = 100_000_000;

export interface IngestOptions {
  origin: "upload" | "scraped";
  sourceUrl?: string | null;
  fileName?: string;
}

export async function convertHeicToJpeg(buf: Buffer): Promise<Buffer> {
  const out = await convertHeic({ buffer: buf, format: "JPEG", quality: 0.92 });
  return Buffer.from(out as Uint8Array);
}

/**
 * Validate an image buffer (magic bytes, size, decodability), convert HEIC/GIF/AVIF to JPEG/PNG,
 * store the original under data/projects/<id>/original and create an Asset row.
 */
export async function ingestImage(projectId: string, input: Buffer, opts: IngestOptions) {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (input.byteLength > maxBytes) {
    throw new UserFacingError(
      `${opts.fileName ?? "Image"} is ${(input.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${env().MAX_UPLOAD_MB} MB.`,
    );
  }
  const detected = detectImageType(input);
  const allowed = opts.origin === "upload" ? UPLOAD_TYPES : SCRAPE_TYPES;
  if (!detected || !allowed.includes(detected)) {
    throw new UserFacingError(
      `${opts.fileName ?? "File"} is not a supported image. Use JPG, PNG, WebP or HEIC.`,
    );
  }

  let buf = input;
  let type: DetectedImage = detected;
  if (detected === "image/heic") {
    try {
      buf = await convertHeicToJpeg(input);
      type = "image/jpeg";
    } catch {
      throw new UserFacingError(
        `${opts.fileName ?? "HEIC image"} could not be converted. Export it as JPEG and retry.`,
      );
    }
  } else if (detected === "image/gif" || detected === "image/avif") {
    buf = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).png().toBuffer();
    type = "image/png";
  }

  let meta: Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UserFacingError(`${opts.fileName ?? "Image"} is corrupted or too large to decode.`);
  }
  if (!meta.width || !meta.height)
    throw new UserFacingError(`${opts.fileName ?? "Image"} has no dimensions.`);
  // Respect EXIF orientation when reporting dimensions.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  const count = await prisma.asset.count({ where: { projectId, discarded: false } });
  if (count >= MAX_IMAGES_PER_PROJECT) {
    throw new UserFacingError(
      `A project can hold up to ${MAX_IMAGES_PER_PROJECT} images. Remove some first.`,
    );
  }

  const id = randomUUID();
  const dir = projectDir(projectId, "original");
  await mkdir(dir, { recursive: true });
  const abs = projectDir(projectId, "original", `${id}.${extensionFor(type)}`);
  await writeFile(abs, buf);

  const flags: ImageFlag[] = [];
  if (opts.origin === "scraped") {
    flags.push({
      code: "third_party_source",
      message: "Downloaded from a third-party page: it may be copyrighted or watermarked.",
    });
  }
  const row = await prisma.asset.create({
    data: {
      id,
      projectId,
      origin: opts.origin,
      sourceUrl: opts.sourceUrl ?? null,
      originalPath: toDataRelative(abs),
      mimeType: type,
      width,
      height,
      bytes: buf.byteLength,
      flags: JSON.stringify(flags),
      position: count,
      isHero: count === 0,
    },
  });
  return hydrateAsset(row);
}
