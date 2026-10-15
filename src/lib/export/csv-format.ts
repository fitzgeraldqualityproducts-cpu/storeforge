/**
 * Shopify product CSV column headers.
 *
 * Shopify's product import template renamed its columns (e.g. "Handle" → "URL handle",
 * "Body (HTML)" → "Description", "Variant Price" → "Price"). The Help Center says Shopify keeps
 * backward compatibility with the older names. Both header sets are encoded here as single
 * constants; `current` is the default and `legacy` is the long-standing template (the column
 * list in the StoreForge spec), offered as a fallback in the export step.
 *
 * Sources (checked 2026-10-15):
 *  - https://help.shopify.com/en/manual/products/import-export/using-csv ("Columns for product
 *    CSV file" table: current names, allowed values, "Barcode" → "Barcodes")
 *  - https://help.shopify.com/en/manual/products/import-export/common-import-issues (legacy
 *    header line). The template file itself couldn't be downloaded from this environment, so
 *    Option2/Option3 current names follow the documented Option1 pattern. See DECISIONS.md.
 *
 * Market-specific columns ("Price / <market>", "Included / <market>"), Google Shopping and
 * metafield columns are omitted: they are optional and their names depend on the store.
 */

/** Internal column keys, independent of the header spelling. */
export const CSV_KEYS = [
  "handle",
  "title",
  "body",
  "vendor",
  "category",
  "type",
  "tags",
  "published",
  "status",
  "sku",
  "barcode",
  "option1Name",
  "option1Value",
  "option1Linked",
  "option2Name",
  "option2Value",
  "option2Linked",
  "option3Name",
  "option3Value",
  "option3Linked",
  "price",
  "compareAt",
  "cost",
  "taxable",
  "tracker",
  "qty",
  "policy",
  "grams",
  "weightUnit",
  "requiresShipping",
  "fulfillment",
  "imageSrc",
  "imagePosition",
  "imageAlt",
  "variantImage",
  "giftCard",
  "seoTitle",
  "seoDescription",
] as const;
export type CsvKey = (typeof CSV_KEYS)[number];
export type CsvRow = Partial<Record<CsvKey, string>>;

export type CsvFormat = "current" | "legacy";

/** Current template headers, in template order. */
export const SHOPIFY_CSV_HEADERS_CURRENT = [
  "Title",
  "URL handle",
  "Description",
  "Vendor",
  "Product category",
  "Type",
  "Tags",
  "Published on online store",
  "Status",
  "SKU",
  "Barcodes",
  "Option1 name",
  "Option1 value",
  "Option1 LinkedTo",
  "Option2 name",
  "Option2 value",
  "Option2 LinkedTo",
  "Option3 name",
  "Option3 value",
  "Option3 LinkedTo",
  "Price",
  "Compare-at price",
  "Cost per item",
  "Charge tax",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Weight value (grams)",
  "Weight unit for display",
  "Requires shipping",
  "Fulfillment service",
  "Product image URL",
  "Image position",
  "Image alt text",
  "Variant image URL",
  "Gift card",
  "SEO title",
  "SEO description",
] as const;

/** Legacy template headers (still accepted on import), in template order. */
export const SHOPIFY_CSV_HEADERS_LEGACY = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Variant Image",
  "Variant Weight Unit",
  "Cost per item",
  "Status",
] as const;

const CURRENT_MAP: Record<(typeof SHOPIFY_CSV_HEADERS_CURRENT)[number], CsvKey> = {
  Title: "title",
  "URL handle": "handle",
  Description: "body",
  Vendor: "vendor",
  "Product category": "category",
  Type: "type",
  Tags: "tags",
  "Published on online store": "published",
  Status: "status",
  SKU: "sku",
  Barcodes: "barcode",
  "Option1 name": "option1Name",
  "Option1 value": "option1Value",
  "Option1 LinkedTo": "option1Linked",
  "Option2 name": "option2Name",
  "Option2 value": "option2Value",
  "Option2 LinkedTo": "option2Linked",
  "Option3 name": "option3Name",
  "Option3 value": "option3Value",
  "Option3 LinkedTo": "option3Linked",
  Price: "price",
  "Compare-at price": "compareAt",
  "Cost per item": "cost",
  "Charge tax": "taxable",
  "Inventory tracker": "tracker",
  "Inventory quantity": "qty",
  "Continue selling when out of stock": "policy",
  "Weight value (grams)": "grams",
  "Weight unit for display": "weightUnit",
  "Requires shipping": "requiresShipping",
  "Fulfillment service": "fulfillment",
  "Product image URL": "imageSrc",
  "Image position": "imagePosition",
  "Image alt text": "imageAlt",
  "Variant image URL": "variantImage",
  "Gift card": "giftCard",
  "SEO title": "seoTitle",
  "SEO description": "seoDescription",
};

const LEGACY_MAP: Record<(typeof SHOPIFY_CSV_HEADERS_LEGACY)[number], CsvKey> = {
  Handle: "handle",
  Title: "title",
  "Body (HTML)": "body",
  Vendor: "vendor",
  "Product Category": "category",
  Type: "type",
  Tags: "tags",
  Published: "published",
  "Option1 Name": "option1Name",
  "Option1 Value": "option1Value",
  "Option2 Name": "option2Name",
  "Option2 Value": "option2Value",
  "Option3 Name": "option3Name",
  "Option3 Value": "option3Value",
  "Variant SKU": "sku",
  "Variant Grams": "grams",
  "Variant Inventory Tracker": "tracker",
  "Variant Inventory Qty": "qty",
  "Variant Inventory Policy": "policy",
  "Variant Fulfillment Service": "fulfillment",
  "Variant Price": "price",
  "Variant Compare At Price": "compareAt",
  "Variant Requires Shipping": "requiresShipping",
  "Variant Taxable": "taxable",
  "Variant Barcode": "barcode",
  "Image Src": "imageSrc",
  "Image Position": "imagePosition",
  "Image Alt Text": "imageAlt",
  "Gift Card": "giftCard",
  "SEO Title": "seoTitle",
  "SEO Description": "seoDescription",
  "Variant Image": "variantImage",
  "Variant Weight Unit": "weightUnit",
  "Cost per item": "cost",
  Status: "status",
};

export function csvHeaders(format: CsvFormat): readonly string[] {
  return format === "current" ? SHOPIFY_CSV_HEADERS_CURRENT : SHOPIFY_CSV_HEADERS_LEGACY;
}

/** Header → internal key for a format. */
export function csvKeyMap(format: CsvFormat): Record<string, CsvKey> {
  return format === "current" ? CURRENT_MAP : LEGACY_MAP;
}

/** Header of `key` in `format`, or null when the format has no such column. */
export function headerFor(format: CsvFormat, key: CsvKey): string | null {
  const map = csvKeyMap(format);
  return Object.keys(map).find((h) => map[h] === key) ?? null;
}

/** Shopify's limits that the builder and validator respect. */
export const SHOPIFY_LIMITS = {
  maxVariants: 2048,
  maxOptions: 3,
  maxImages: 250,
  maxTags: 250,
  /** Descriptions this long are almost always a mistake (pasted page source). */
  descriptionWarnChars: 60_000,
  descriptionMaxChars: 512_000,
} as const;
