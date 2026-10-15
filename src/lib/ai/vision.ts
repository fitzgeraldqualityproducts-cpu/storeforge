import "server-only";
import { readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { ImageAsset } from "@/lib/schemas";
import { fromDataRelative } from "@/lib/security/paths";

export const MAX_VISION_IMAGES = 8;
/** Long edge sent to the model; larger images are downscaled server-side anyway. */
const VISION_EDGE = 1568;

/** Labelled image blocks for a multimodal request ("Image 1", "Image 2", …). */
export async function visionBlocks(
  assets: ImageAsset[],
): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const [i, a] of assets.slice(0, MAX_VISION_IMAGES).entries()) {
    const buf = await readFile(fromDataRelative(a.originalPath));
    const jpeg = await sharp(buf, { limitInputPixels: 100_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(VISION_EDGE, VISION_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    blocks.push({
      type: "text",
      text: `Image ${i + 1}${a.origin === "scraped" ? " (downloaded from the product page)" : " (uploaded by the merchant)"}:`,
    });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
    });
  }
  return blocks;
}
