import "server-only";
import { env } from "@/lib/config";
import { UserFacingError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";

const ENDPOINTS = {
  removebg: { url: "https://api.remove.bg/v1.0/removebg", header: "X-Api-Key" },
  photoroom: { url: "https://sdk.photoroom.com/v1/segment", header: "x-api-key" },
} as const;

export function backgroundRemovalConfigured() {
  const e = env();
  return e.REMOVE_BG_PROVIDER !== "none" && Boolean(e.REMOVE_BG_API_KEY);
}

class RetryableHttp extends Error {}

/**
 * Remove the background via the configured provider (remove.bg or Photoroom). Returns a PNG
 * with transparency; the processing step then flattens it onto the chosen canvas colour.
 */
export async function removeBackground(image: Buffer, mimeType: string): Promise<Buffer> {
  const e = env();
  if (e.REMOVE_BG_PROVIDER === "none" || !e.REMOVE_BG_API_KEY) {
    throw new UserFacingError(
      "Background removal isn't configured (set REMOVE_BG_PROVIDER and REMOVE_BG_API_KEY).",
    );
  }
  const ep = ENDPOINTS[e.REMOVE_BG_PROVIDER];
  return withRetry(
    async () => {
      const form = new FormData();
      form.append("image_file", new Blob([new Uint8Array(image)], { type: mimeType }), "image");
      if (e.REMOVE_BG_PROVIDER === "removebg") {
        form.append("size", "auto");
        form.append("format", "png");
      }
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { [ep.header]: e.REMOVE_BG_API_KEY! },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new RetryableHttp(`HTTP ${res.status}`);
      if (!res.ok) {
        throw new UserFacingError(
          `Background removal failed (${e.REMOVE_BG_PROVIDER} returned HTTP ${res.status}). Check the API key and credits.`,
        );
      }
      return Buffer.from(await res.arrayBuffer());
    },
    { retries: 2, shouldRetry: (err) => !(err instanceof UserFacingError) },
  );
}
