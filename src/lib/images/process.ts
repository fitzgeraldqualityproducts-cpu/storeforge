import sharp from "sharp";

export const MAX_DIMENSION = 2048;
export const OUTPUT_QUALITY = 85;

export interface ProcessOptions {
  squarePad: boolean;
  /** Canvas colour for square padding and for flattening transparency. */
  background: string;
  maxDimension?: number;
}

export interface ProcessedImage {
  webp: Buffer;
  jpeg: Buffer;
  width: number;
  height: number;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Auto-rotate from EXIF, trim uniform borders, fit within 2048px, optionally pad to a square
 * canvas, and encode WebP q85 plus a JPEG q85 fallback. sharp drops EXIF/ICC/XMP metadata by
 * default (we never call withMetadata), so outputs are stripped.
 */
export async function processImage(input: Buffer, opts: ProcessOptions): Promise<ProcessedImage> {
  const max = opts.maxDimension ?? MAX_DIMENSION;
  const bg = { ...hexToRgb(opts.background), alpha: 1 };

  // 1. Orientation + flatten transparency onto the canvas colour.
  let buf = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .flatten({ background: bg })
    .toBuffer();

  // 2. Trim uniform borders (sharp throws if the whole image is uniform; then keep it as is).
  try {
    const trimmed = await sharp(buf).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    const before = await sharp(buf).metadata();
    // Guard against over-trimming low-contrast products: keep at least 40% of each side.
    if (
      trimmed.info.width >= (before.width ?? 0) * 0.4 &&
      trimmed.info.height >= (before.height ?? 0) * 0.4
    ) {
      buf = trimmed.data;
    }
  } catch {
    /* uniform image: nothing to trim */
  }

  // 3. Resize to fit within max×max (never upscale).
  let pipeline = sharp(buf).resize(max, max, { fit: "inside", withoutEnlargement: true });
  let out = await pipeline.toBuffer({ resolveWithObject: true });

  // 4. Square canvas with a small margin so products don't touch the edges.
  if (opts.squarePad) {
    const side = Math.min(max, Math.max(out.info.width, out.info.height));
    const inner = Math.round(side * 0.92);
    const fitted = await sharp(out.data)
      .resize(inner, inner, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const padX = side - fitted.info.width;
    const padY = side - fitted.info.height;
    pipeline = sharp(fitted.data).extend({
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      background: bg,
    });
    out = await pipeline.toBuffer({ resolveWithObject: true });
  }

  const webp = await sharp(out.data).webp({ quality: OUTPUT_QUALITY, effort: 4 }).toBuffer();
  const jpeg = await sharp(out.data).jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true }).toBuffer();
  return { webp, jpeg, width: out.info.width, height: out.info.height };
}
