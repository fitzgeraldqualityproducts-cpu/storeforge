import type { ProductListing, ProductVariant } from "@/lib/schemas";
import { csvHeaders, csvKeyMap, type CsvFormat, type CsvRow } from "./csv-format";

/** One exported image: its file name in the bundle and, in public-URL mode, its URL. */
export interface CsvImage {
  assetId: string;
  fileName: string;
  url: string | null;
  alt: string;
  /** "Option:Value" from the image step's variant mapping, e.g. "Color:Sage". */
  variantKey: string | null;
}

const bool = (b: boolean) => (b ? "TRUE" : "FALSE");
const money = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));

/** Quote a cell when needed (RFC 4180): commas, quotes, line breaks or edge whitespace. */
export function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(format: CsvFormat, rows: CsvRow[]): string {
  const headers = csvHeaders(format);
  const map = csvKeyMap(format);
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[map[h]!] ?? "")).join(","));
  // UTF-8 without a byte-order mark; one trailing newline.
  return `${lines.join("\n")}\n`;
}

/** Image for a variant: its explicit imageId, else an image mapped to one of its option values. */
export function variantImageFor(
  listing: ProductListing,
  variant: ProductVariant,
  images: CsvImage[],
): CsvImage | null {
  if (variant.imageId) {
    const byId = images.find((i) => i.assetId === variant.imageId);
    if (byId) return byId;
  }
  const values = [variant.option1, variant.option2, variant.option3];
  for (const img of images) {
    if (!img.variantKey) continue;
    const at = img.variantKey.indexOf(":");
    const name = img.variantKey.slice(0, at);
    const value = img.variantKey.slice(at + 1);
    const idx = listing.options.findIndex((o) => o.name === name);
    if (idx >= 0 && values[idx] === value) return img;
  }
  return null;
}

/**
 * Product CSV rows: one row per variant (the first carries the product-level fields and the
 * first image), then one row per additional image with only the image columns filled.
 * With `withImages: false` (upload-images-after-import mode) no image columns are filled.
 */
export function buildProductRows(
  listing: ProductListing,
  images: CsvImage[],
  opts: { withImages: boolean },
): CsvRow[] {
  const handle = listing.handle;
  const imgs = opts.withImages ? images.filter((i) => i.url) : [];
  const rows: CsvRow[] = listing.variants.map((v, i) => {
    const row: CsvRow = {
      handle,
      option1Value: v.option1,
      option2Value: v.option2 ?? "",
      option3Value: v.option3 ?? "",
      sku: v.sku,
      grams: String(Math.max(0, Math.round(v.grams))),
      tracker: "shopify",
      qty: String(Math.max(0, Math.round(v.inventoryQty))),
      policy: "deny",
      fulfillment: "manual",
      price: money(v.price),
      compareAt: money(v.compareAtPrice),
      requiresShipping: bool(true),
      taxable: bool(true),
      barcode: v.barcode ?? "",
      weightUnit: v.grams >= 1000 ? "kg" : "g",
      cost: money(v.costPerItem),
      variantImage: opts.withImages ? (variantImageFor(listing, v, imgs)?.url ?? "") : "",
    };
    if (i === 0) {
      Object.assign(row, {
        title: listing.title,
        body: listing.descriptionHtml,
        vendor: listing.vendor,
        category: listing.shopifyCategory,
        type: listing.productType,
        tags: listing.tags.join(", "),
        published: bool(true),
        status: listing.status,
        option1Name: listing.options[0]?.name ?? "Title",
        option2Name: listing.options[1]?.name ?? "",
        option3Name: listing.options[2]?.name ?? "",
        giftCard: bool(false),
        seoTitle: listing.seoTitle,
        seoDescription: listing.seoDescription,
      } satisfies CsvRow);
      if (imgs[0]) {
        row.imageSrc = imgs[0].url!;
        row.imagePosition = "1";
        row.imageAlt = imgs[0].alt;
      }
    }
    return row;
  });
  imgs.slice(1).forEach((img, i) => {
    rows.push({ handle, imageSrc: img.url!, imagePosition: String(i + 2), imageAlt: img.alt });
  });
  return rows;
}

export function buildProductCsv(
  listing: ProductListing,
  images: CsvImage[],
  opts: { format: CsvFormat; withImages: boolean },
) {
  const rows = buildProductRows(listing, images, opts);
  return { csv: toCsv(opts.format, rows), rows };
}

/** image-mapping.csv for the upload-after-import mode: which file goes where. */
export function imageMappingCsv(listing: ProductListing, images: CsvImage[]): string {
  const lines = [["File", "Position", "Alt text", "Product handle", "Use for variants"].join(",")];
  images.forEach((img, i) => {
    const variants = listing.variants
      .filter((v) => variantImageFor(listing, v, images)?.assetId === img.assetId)
      .map((v) => [v.option1, v.option2, v.option3].filter(Boolean).join(" / "));
    lines.push(
      [img.fileName, String(i + 1), img.alt, listing.handle, variants.join("; ")]
        .map(csvCell)
        .join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}
