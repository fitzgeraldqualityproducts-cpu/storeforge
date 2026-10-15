import { parsePriceText, type ParsedPage } from "../parse";
import type { SiteAdapter } from "./types";

/** AliExpress item pages: product data is embedded in inline scripts (imagePathList, subject). */
export const aliexpressAdapter: SiteAdapter = {
  name: "aliexpress",
  matches: (url) =>
    /(^|\.)aliexpress\.[a-z.]+$/i.test(url.hostname) && /\/item\//.test(url.pathname),
  async enhance(parsed, { $, html }): Promise<ParsedPage> {
    if (!html) return parsed;
    try {
      const images: ParsedPage["images"] = [];
      const list = html.match(/"imagePathList"\s*:\s*(\[[^\]]*\])/);
      if (list) {
        for (const u of JSON.parse(list[1]!) as string[]) {
          images.push({
            url: u.startsWith("//") ? `https:${u}` : u,
            alt: "",
            width: null,
            height: null,
            source: "adapter",
          });
        }
      }
      const subject = html.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const title = subject
        ? JSON.parse(`"${subject[1]}"`)
        : $?.("h1").first().text().trim() || parsed.title;
      const priceMatch = html.match(
        /"formatedActivityPrice"\s*:\s*"([^"]+)"|"formatedPrice"\s*:\s*"([^"]+)"/,
      );
      const priceText = priceMatch ? (priceMatch[1] ?? priceMatch[2] ?? "") : "";
      const amount = priceText ? parsePriceText(priceText) : null;
      const specs: Record<string, string> = {};
      for (const m of html.matchAll(
        /"attrName"\s*:\s*"([^"]+)"\s*,\s*"attrValue"\s*:\s*"([^"]+)"/g,
      )) {
        specs[m[1]!] = m[2]!;
      }
      return {
        ...parsed,
        title: title || parsed.title,
        price:
          amount != null ? { amount, currency: parsed.price?.currency ?? "USD" } : parsed.price,
        specs: { ...parsed.specs, ...specs },
        images: [...images, ...parsed.images],
      };
    } catch {
      return parsed;
    }
  },
};
