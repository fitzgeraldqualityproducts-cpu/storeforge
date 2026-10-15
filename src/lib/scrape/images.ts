import sharp from "sharp";
import type { ExtractedImage } from "@/lib/schemas";
import { mapLimit } from "@/lib/retry";
import { detectImageType, SCRAPE_TYPES } from "@/lib/images/magic";
import { safeFetch } from "./http";
import type { UrlPolicy } from "./ssrf";

export const MIN_SHORT_SIDE = 300;
export const DOWNLOAD_CONCURRENCY = 4;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const AD_DOMAINS =
  /(doubleclick\.net|googlesyndication|google-analytics|googletagmanager|facebook\.com\/tr|adservice|adsystem|amazon-adsystem|criteo|taboola|outbrain|scorecardresearch|quantserve|pixel\.|\/pixel|bat\.bing)/i;
const NOT_PRODUCT =
  /(sprite|icon|logo|favicon|badge|flag|avatar|placeholder|spinner|loading|blank|transparent|1x1|pixel|payment|visa|mastercard|paypal|rating|star|social|share|arrow|chevron|banner-ad)/i;

/**
 * Upgrade known CDN thumbnail URLs to full-size originals where the transformation is
 * deterministic and safe. Unknown URLs are returned unchanged.
 */
export function upgradeCdnUrl(raw: string): string {
  let url = raw;
  try {
    const u = new URL(url);
    const host = u.hostname;
    // Shopify CDN: name_300x300.jpg / name_300x.jpg / name_x300@2x.jpg → name.jpg ; drop width/height params
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) {
      u.pathname = u.pathname.replace(
        /_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(@\dx)?(?=\.[a-z]+$)/i,
        "",
      );
      u.searchParams.delete("width");
      u.searchParams.delete("height");
      u.searchParams.delete("crop");
      return u.toString();
    }
    // Amazon: name._AC_SX300_SY300_.jpg → name.jpg
    if (/media-amazon\.com|images-amazon\.com|ssl-images-amazon/.test(host)) {
      u.pathname = u.pathname.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, ".$1");
      return u.toString();
    }
    // AliExpress / Alibaba: name.jpg_220x220.jpg / name.jpg_Q90.jpg_.webp → name.jpg
    if (/alicdn\.com/.test(host)) {
      u.pathname = u.pathname.replace(/(\.(jpg|jpeg|png|webp))(_[^/]*)$/i, "$1");
      return u.toString();
    }
    // Etsy: il_340x270.123_abc.jpg → il_fullxfull.123_abc.jpg
    if (/etsystatic\.com/.test(host)) {
      u.pathname = u.pathname.replace(/il_\d+x[\dN]+\./, "il_fullxfull.");
      return u.toString();
    }
    // WordPress/WooCommerce: name-300x300.jpg → name.jpg
    if (/\/wp-content\/uploads\//.test(u.pathname)) {
      u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(jpg|jpeg|png|webp)$)/i, "");
      return u.toString();
    }
    url = u.toString();
  } catch {
    return raw;
  }
  return url;
}

/** Filter obvious non-product images and dedupe by (upgraded) URL, keeping source priority order. */
export type ImageCandidate = ExtractedImage & { originalUrl: string };

export function selectImageCandidates(images: ExtractedImage[], limit = 15): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  const priority: Record<ExtractedImage["source"], number> = {
    adapter: 0,
    jsonld: 1,
    microdata: 2,
    og: 3,
    srcset: 4,
    lazy: 5,
    img: 6,
    twitter: 7,
  };
  const sorted = [...images].sort((a, b) => priority[a.source] - priority[b.source]);
  for (const img of sorted) {
    let u: URL;
    try {
      u = new URL(img.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (/\.svg(\?|$)/i.test(u.pathname) || /\.gif(\?|$)/i.test(u.pathname)) continue;
    if (AD_DOMAINS.test(img.url)) continue;
    if (NOT_PRODUCT.test(u.pathname.split("/").pop() ?? "") || NOT_PRODUCT.test(img.alt)) continue;
    if ((img.width && img.width < MIN_SHORT_SIDE) || (img.height && img.height < MIN_SHORT_SIDE)) {
      // Declared small; still allow if a CDN upgrade may make it larger.
      if (upgradeCdnUrl(img.url) === img.url) continue;
    }
    const upgraded = upgradeCdnUrl(img.url);
    const key = upgraded.replace(/[?#].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...img, url: upgraded, originalUrl: img.url });
    if (out.length >= limit) break;
  }
  return out;
}

export interface DownloadedImage {
  url: string;
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Download candidates server-side (concurrency 4), verify magic bytes and size, and drop images
 * whose shortest side is under 300px. Falls back to the original URL if an upgraded one fails.
 */
export async function downloadImages(
  candidates: { url: string; fallbackUrl?: string }[],
  policy: UrlPolicy,
): Promise<{ images: DownloadedImage[]; failures: string[] }> {
  const failures: string[] = [];
  const results = await mapLimit(candidates, DOWNLOAD_CONCURRENCY, async (c) => {
    for (const url of [c.url, c.fallbackUrl].filter((x): x is string => Boolean(x))) {
      try {
        const res = await safeFetch(url, {
          policy,
          maxBytes: MAX_IMAGE_BYTES,
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          retries: 1,
        });
        if (res.status !== 200) continue;
        const type = detectImageType(res.body);
        if (!type || !SCRAPE_TYPES.includes(type)) continue;
        if (type === "image/heic") continue;
        const meta = await sharp(res.body, { limitInputPixels: 100_000_000 }).metadata();
        if (!meta.width || !meta.height) continue;
        if (Math.min(meta.width, meta.height) < MIN_SHORT_SIDE) continue;
        return { url, buffer: res.body, width: meta.width, height: meta.height };
      } catch {
        /* try fallback */
      }
    }
    failures.push(c.url);
    return null;
  });
  return { images: results.filter((r): r is DownloadedImage => r !== null), failures };
}
