import { z } from "zod";
import { htmlToText } from "@/lib/html/sanitize";
import { safeFetch } from "../http";
import type { ParsedPage } from "../parse";
import type { SiteAdapter } from "./types";

const ShopifyProductJson = z.object({
  product: z.object({
    title: z.string(),
    body_html: z.string().nullable().optional(),
    vendor: z.string().nullable().optional(),
    product_type: z.string().nullable().optional(),
    tags: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    options: z
      .array(z.object({ name: z.string(), values: z.array(z.string()).optional() }))
      .optional()
      .default([]),
    variants: z
      .array(
        z.object({
          title: z.string().optional().default(""),
          price: z.union([z.string(), z.number()]).nullable().optional(),
          sku: z.string().nullable().optional(),
          barcode: z.string().nullable().optional(),
          option1: z.string().nullable().optional(),
          option2: z.string().nullable().optional(),
          option3: z.string().nullable().optional(),
          image_id: z.number().nullable().optional(),
        }),
      )
      .optional()
      .default([]),
    images: z
      .array(
        z.object({
          id: z.number().optional(),
          src: z.string(),
          alt: z.string().nullable().optional(),
          width: z.number().nullable().optional(),
          height: z.number().nullable().optional(),
        }),
      )
      .optional()
      .default([]),
  }),
});

export function shopifyHandleFromUrl(url: URL): string | null {
  const m = url.pathname.match(/\/products\/([a-z0-9][a-z0-9\-_.%]*)\/?$/i);
  if (!m) return null;
  return m[1]!.replace(/\.(json|js|xml)$/i, "");
}

/** Generic Shopify storefronts: use the public /products/<handle>.json endpoint when present. */
export const shopifyAdapter: SiteAdapter = {
  name: "shopify",
  matches: (url) => shopifyHandleFromUrl(url) !== null,
  async enhance(parsed, ctx): Promise<ParsedPage> {
    const looksShopify =
      /cdn\.shopify\.com|Shopify\.theme|shopify-section|\/cdn\/shop\//.test(ctx.html ?? "") ||
      ctx.url.hostname.endsWith(".myshopify.com");
    if (!looksShopify && ctx.html !== null) return parsed;
    const handle = shopifyHandleFromUrl(ctx.url);
    if (!handle) return parsed;
    try {
      const res = await safeFetch(`${ctx.url.origin}/products/${handle}.json`, {
        policy: ctx.policy,
        accept: "application/json",
        maxBytes: 3 * 1024 * 1024,
        retries: 0,
      });
      if (res.status !== 200) return parsed;
      const data = ShopifyProductJson.safeParse(JSON.parse(res.body.toString("utf8")));
      if (!data.success) return parsed;
      const p = data.data.product;
      const imagesById = new Map(p.images.filter((i) => i.id).map((i) => [i.id!, i.src]));
      const variants = p.variants.map((v) => ({
        title: v.title,
        options: [v.option1, v.option2, v.option3].filter((x): x is string => Boolean(x)),
        sku: v.sku || null,
        price: v.price != null ? Number(v.price) : null,
        available: null,
        imageUrl: v.image_id ? (imagesById.get(v.image_id) ?? null) : null,
      }));
      const options = p.options
        .filter((o) => !(o.name === "Title" && (o.values ?? []).join() === "Default Title"))
        .map((o, idx) => ({
          name: o.name,
          values: o.values?.length
            ? o.values
            : [
                ...new Set(
                  variants.map((v) => v.options[idx]).filter((x): x is string => Boolean(x)),
                ),
              ],
        }));
      const firstPrice = variants.find((v) => v.price != null)?.price ?? null;
      const tags = Array.isArray(p.tags)
        ? p.tags
        : (p.tags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
      const description = p.body_html ? htmlToText(p.body_html) : parsed.description;
      return {
        ...parsed,
        title: p.title || parsed.title,
        description,
        brand: p.vendor || parsed.brand,
        price:
          firstPrice != null
            ? { amount: firstPrice, currency: parsed.price?.currency ?? "USD" }
            : parsed.price,
        options: options.length ? options : parsed.options,
        variants: options.length ? variants : parsed.variants,
        specs: {
          ...parsed.specs,
          ...(p.product_type ? { "Product type": p.product_type } : {}),
          ...(tags.length ? { Tags: tags.join(", ") } : {}),
        },
        images: [
          ...p.images.map((i) => ({
            url: i.src.startsWith("//") ? `https:${i.src}` : i.src,
            alt: i.alt ?? "",
            width: i.width ?? null,
            height: i.height ?? null,
            source: "adapter" as const,
          })),
          ...parsed.images,
        ],
        rawText:
          parsed.rawText.length < 500 && description
            ? `${parsed.rawText} ${description}`.trim()
            : parsed.rawText,
      };
    } catch {
      return parsed;
    }
  },
};
