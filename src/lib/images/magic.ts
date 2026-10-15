/** Image type detection from magic bytes (never trust file extensions or Content-Type). */
export type DetectedImage =
  "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/gif" | "image/avif";

export function detectImageType(buf: Uint8Array): DetectedImage | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  // ISO-BMFF: size(4) "ftyp" brand(4)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand))
      return "image/heic";
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/** Types accepted from uploads (spec: JPG/PNG/WebP/HEIC). Scraped images may also be GIF/AVIF. */
export const UPLOAD_TYPES: DetectedImage[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];
export const SCRAPE_TYPES: DetectedImage[] = [...UPLOAD_TYPES, "image/gif", "image/avif"];

export function extensionFor(type: DetectedImage) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
    "image/avif": "avif",
  }[type];
}
