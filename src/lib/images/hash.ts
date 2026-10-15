import sharp from "sharp";

const N = 32;
const COS: number[][] = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
);

/**
 * 64-bit DCT perceptual hash (pHash). The image is smoothed at 128px before the 32×32 DCT so
 * re-encoded or resized copies land within a few bits, while different shots of the same product
 * on the same backdrop stay far apart (a plain 9×8 dHash conflated those in testing; see
 * DECISIONS.md). Returned as 16 hex chars.
 */
export async function perceptualHash(input: Buffer): Promise<string> {
  const small = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(128, 128, { fit: "fill" })
    .blur(2)
    .toBuffer();
  const { data } = await sharp(small)
    .resize(N, N, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const coeffs: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < N; y++) {
        const cy = COS[v]![y]!;
        for (let x = 0; x < N; x++) s += data[y * N + x]! * COS[u]![x]! * cy;
      }
      // Orthonormal DCT-II scaling (affects which side of the median the edge terms fall).
      coeffs.push(s * (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1));
    }
  }
  // Median of the AC coefficients (excluding the DC term) as the threshold.
  const ac = coeffs.slice(1).sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)]!;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let k = 0; k < 4; k++) nibble = (nibble << 1) | (coeffs[i + k]! > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/** Hashes within this Hamming distance are treated as the same picture. */
export const DUPLICATE_THRESHOLD = 6;
