import type { ParsedPage } from "../parse";
import type { SiteAdapter } from "./types";

/** Etsy listings: JSON-LD covers most fields; add full-size gallery images. */
export const etsyAdapter: SiteAdapter = {
  name: "etsy",
  matches: (url) => /(^|\.)etsy\.com$/i.test(url.hostname) && /\/listing\//.test(url.pathname),
  async enhance(parsed, { $ }): Promise<ParsedPage> {
    if (!$) return parsed;
    try {
      const images: ParsedPage["images"] = [];
      $("[data-src-zoom-image], img[data-zoom-src]").each((_, el) => {
        const u = $(el).attr("data-src-zoom-image") ?? $(el).attr("data-zoom-src");
        if (u)
          images.push({
            url: u,
            alt: $(el).attr("alt") ?? "",
            width: null,
            height: null,
            source: "adapter",
          });
      });
      return { ...parsed, images: [...images, ...parsed.images] };
    } catch {
      return parsed;
    }
  },
};
