import sanitizeHtml from "sanitize-html";

/** Tags allowed in product descriptions (spec Section 6.4). */
export const LISTING_ALLOWED_TAGS = [
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "h2",
  "h3",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "br",
  "a",
] as const;

const linkAttrs: sanitizeHtml.IOptions["allowedAttributes"] = { a: ["href", "title"] };

const base: sanitizeHtml.IOptions = {
  allowedAttributes: linkAttrs,
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    b: "strong",
    i: "em",
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
  },
};

/** Sanitize AI- or user-provided product description HTML to the safe tag list. */
export function sanitizeListingHtml(html: string): string {
  return sanitizeHtml(html, { ...base, allowedTags: [...LISTING_ALLOWED_TAGS] }).trim();
}

/** Pages allow the listing tags. Same safe subset keeps Shopify pages clean. */
export function sanitizePageHtml(html: string): string {
  return sanitizeListingHtml(html);
}

/** Strip all markup (used for text comparisons, previews and meta descriptions). */
export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<(br|\/p|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "$& "), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
