import { parsePriceText, detectCurrency, type ParsedPage } from "../parse";
import type { SiteAdapter } from "./types";

/** Amazon product pages (DOM selectors). Bot walls are detected upstream and never bypassed. */
export const amazonAdapter: SiteAdapter = {
  name: "amazon",
  matches: (url) =>
    /(^|\.)amazon\.[a-z.]+$/i.test(url.hostname) && /\/(dp|gp\/product)\//.test(url.pathname),
  async enhance(parsed, { $, html }): Promise<ParsedPage> {
    if (!$ || !html) return parsed;
    try {
      const title = $("#productTitle").text().replace(/\s+/g, " ").trim() || parsed.title;
      const priceText =
        $(".a-price .a-offscreen").first().text().trim() || $("#priceblock_ourprice").text().trim();
      const amount = priceText ? parsePriceText(priceText) : null;
      const bullets = $("#feature-bullets li")
        .map((_, li) => $(li).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);
      const images: ParsedPage["images"] = [];
      const dyn = $("#landingImage").attr("data-a-dynamic-image");
      if (dyn) {
        try {
          const entries = Object.entries(JSON.parse(dyn) as Record<string, [number, number]>);
          entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
          for (const [u, [w, h]] of entries.slice(0, 1))
            images.push({ url: u, alt: "", width: w, height: h, source: "adapter" });
        } catch {
          /* ignore */
        }
      }
      for (const m of html.matchAll(/"hiRes":"(https:[^"]+)"/g)) {
        images.push({ url: m[1]!, alt: "", width: null, height: null, source: "adapter" });
      }
      const specs: Record<string, string> = {};
      $("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr").each(
        (_, tr) => {
          const k = $(tr).find("th").text().replace(/\s+/g, " ").trim();
          const v = $(tr).find("td").text().replace(/\s+/g, " ").trim();
          if (k && v) specs[k] = v;
        },
      );
      $("#detailBullets_feature_div li").each((_, li) => {
        const parts = $(li).text().replace(/\s+/g, " ").split(":");
        if (parts.length >= 2) {
          const k = parts[0]!.replace(/[^\w\s()]/g, "").trim();
          const v = parts.slice(1).join(":").trim();
          if (k && v && k.length < 50) specs[k] = v;
        }
      });
      const brand = $("#bylineInfo")
        .text()
        .replace(/^(Visit the|Brand:)\s*/i, "")
        .replace(/\s*Store$/i, "")
        .trim();
      return {
        ...parsed,
        title,
        brand: brand || parsed.brand,
        price:
          amount != null
            ? { amount, currency: detectCurrency(priceText) ?? parsed.price?.currency ?? "USD" }
            : parsed.price,
        description: bullets.length ? bullets.join(" ") : parsed.description,
        specs: { ...parsed.specs, ...specs },
        images: [...images, ...parsed.images],
      };
    } catch {
      return parsed;
    }
  },
};
