import sharp from "sharp";
import type { ImageFlag } from "@/lib/schemas";

export interface QualityResult {
  score: number;
  note: string;
  flags: ImageFlag[];
  metrics: {
    width: number;
    height: number;
    blurVariance: number;
    meanLuma: number;
    clippedDark: number;
    clippedBright: number;
    aspect: number;
  };
}

/** Vision-model findings merged into the score when available (watermark, text overlay…). */
export interface VisionQualityFlags {
  watermark?: boolean;
  textOverlay?: boolean;
  notProduct?: boolean;
}

const ANALYSIS_SIZE = 512;

/** Variance of the 4-neighbour Laplacian over a grayscale buffer (higher = sharper). */
export function laplacianVariance(data: Uint8Array | Buffer, width: number, height: number) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = data[i - width]! + data[i + width]! + data[i - 1]! + data[i + 1]! - 4 * data[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * Score 0–100 from resolution, sharpness (Laplacian variance), exposure (histogram) and aspect
 * ratio, minus penalties for vision flags. Returns a plain-English explanation.
 */
export async function scoreQuality(
  input: Buffer,
  vision: VisionQualityFlags = {},
): Promise<QualityResult> {
  const base = sharp(input, { limitInputPixels: 100_000_000 }).rotate();
  const meta = await base.metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  const { data, info } = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blurVariance = laplacianVariance(data, info.width, info.height);
  let total = 0;
  let dark = 0;
  let bright = 0;
  for (const v of data) {
    total += v;
    if (v <= 8) dark++;
    if (v >= 250) bright++;
  }
  const px = data.length || 1;
  const meanLuma = total / px;
  const clippedDark = dark / px;
  const clippedBright = bright / px;
  const shortSide = Math.min(width, height);
  const aspect = Math.max(width, height) / Math.max(1, shortSide);

  const flags: ImageFlag[] = [];
  const notes: string[] = [];

  // Resolution: 2048px short side is ideal for Shopify zoom; 800 is the practical minimum.
  const resScore = clamp((shortSide - 300) / (1600 - 300));
  if (shortSide < 800) {
    flags.push({
      code: "low_resolution",
      message: `Only ${width}×${height}px; aim for 2048px or more.`,
    });
    notes.push("low resolution");
  } else notes.push(`${width}×${height}px`);

  // Sharpness: thresholds tuned on product photos at 512px analysis size.
  const sharpScore = clamp((blurVariance - 20) / (300 - 20));
  if (blurVariance < 60) {
    flags.push({ code: "blurry", message: "Looks soft or out of focus." });
    notes.push("soft focus");
  } else notes.push("sharp");

  // Exposure: a white product background legitimately clips highlights, so judge mid-tones.
  let exposureScore = 1;
  if (meanLuma < 55 || clippedDark > 0.35) {
    exposureScore = clamp(meanLuma / 90);
    flags.push({ code: "under_exposed", message: "Too dark; detail is lost in the shadows." });
    notes.push("under-exposed");
  } else if (meanLuma > 245 && clippedBright > 0.92) {
    exposureScore = 0.3;
    flags.push({ code: "over_exposed", message: "Washed out; the product barely stands out." });
    notes.push("over-exposed");
  }

  let aspectScore = 1;
  if (aspect > 2.5) {
    aspectScore = 0.3;
    flags.push({
      code: "extreme_aspect",
      message: `Very wide or tall (${aspect.toFixed(1)}:1); it will be heavily padded when squared.`,
    });
    notes.push("extreme aspect ratio");
  }

  let score = Math.round(
    100 * (0.35 * resScore + 0.35 * sharpScore + 0.2 * exposureScore + 0.1 * aspectScore),
  );
  if (vision.watermark) {
    score -= 35;
    flags.push({
      code: "watermark",
      message: "A watermark is visible. Use a clean original you own.",
    });
    notes.push("watermark");
  }
  if (vision.textOverlay) {
    score -= 15;
    flags.push({
      code: "text_overlay",
      message: "Has text overlaid; fine for infographics, not for the hero.",
    });
    notes.push("text overlay");
  }
  if (vision.notProduct) {
    score -= 40;
    flags.push({ code: "not_product", message: "Doesn't appear to show the product." });
    notes.push("not the product");
  }
  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 75 ? "Great" : score >= 50 ? "Usable" : score >= 30 ? "Weak" : "Poor";
  return {
    score,
    note: `${verdict}: ${notes.join(", ")}.`,
    flags,
    metrics: {
      width,
      height,
      blurVariance: Math.round(blurVariance),
      meanLuma: Math.round(meanLuma),
      clippedDark,
      clippedBright,
      aspect,
    },
  };
}

/** Below this, an image is discarded automatically (if enough better images remain). */
export const DISCARD_BELOW = 30;
