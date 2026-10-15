import { palettePassesAA, checkPalette } from "@/lib/brand/contrast";
import { findPlaceholders } from "@/lib/content/structure";
import { ALT_MAX, HANDLE_MAX, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@/lib/listing/text";
import { validateVariants } from "@/lib/listing/variants";
import { formatMoney } from "@/lib/utils";
import type {
  BrandKit,
  ImageAsset,
  ProductAnalysis,
  ProductListing,
  StoreContent,
  WizardStep,
} from "@/lib/schemas";

/**
 * Pre-flight checklist (spec Step 7). Pure, so the server (export step, push route) and tests
 * share one definition. "fail" items block a live Shopify push; the ZIP can still be
 * downloaded, with the failures listed.
 */

export interface PreflightItem {
  id:
    | "required"
    | "images"
    | "alt"
    | "seo"
    | "contrast"
    | "risk"
    | "placeholders"
    | "margin"
    | "variants"
    | "handle"
    | "confirm";
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  /** Where to fix it. */
  step: WizardStep;
}

export interface Preflight {
  ok: boolean;
  failed: number;
  warnings: number;
  items: PreflightItem[];
}

export interface PreflightInput {
  listing: ProductListing | null;
  content: StoreContent | null;
  brand: BrandKit | null;
  analysis: ProductAnalysis | null;
  /** Active (not discarded) images. */
  assets: ImageAsset[];
  /** Product handles used by the merchant's other StoreForge projects. */
  otherHandles?: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function runPreflight(i: PreflightInput): Preflight {
  const items: PreflightItem[] = [];
  const add = (item: PreflightItem) => items.push(item);
  const { listing, content, brand } = i;
  const currency = content?.settings.currency || "USD";

  // Required fields
  const missing: string[] = [];
  if (!listing) missing.push("product listing");
  else {
    if (!listing.title.trim()) missing.push("title");
    if (!listing.descriptionHtml.replace(/<[^>]+>/g, "").trim()) missing.push("description");
    if (!listing.vendor.trim()) missing.push("vendor");
    if (!listing.productType.trim()) missing.push("product type");
  }
  if (!brand?.selectedName) missing.push("store name (brand step)");
  if (!content) missing.push("store content");
  add({
    id: "required",
    label: "Required fields",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? `Missing: ${missing.join(", ")}.`
      : "Title, description, vendor, type, store name and content are set.",
    step: !listing ? "listing" : !brand?.selectedName ? "brand" : !content ? "content" : "listing",
  });

  // Images
  const imageCount = i.assets.length;
  add({
    id: "images",
    label: "At least 3 product images",
    status: imageCount >= 3 ? "pass" : "fail",
    detail: `${plural(imageCount, "image")} in the gallery.${imageCount < 3 ? " Shopify product pages convert better with several angles; add more photos." : ""}`,
    step: "images",
  });

  const noAlt = i.assets.filter((a) => !a.altText.trim()).length;
  const longAlt = i.assets.filter((a) => a.altText.length > ALT_MAX).length;
  add({
    id: "alt",
    label: "Alt text on every image",
    status: !imageCount || noAlt || longAlt ? "fail" : "pass",
    detail: !imageCount
      ? "No images yet."
      : noAlt
        ? `${plural(noAlt, "image")} without alt text.`
        : longAlt
          ? `${plural(longAlt, "alt text")} longer than ${ALT_MAX} characters.`
          : "Every image describes itself for screen readers and search.",
    step: "images",
  });

  // SEO lengths
  if (listing) {
    const seo: string[] = [];
    if (!listing.seoTitle.trim()) seo.push("SEO title is empty");
    else if (listing.seoTitle.length > SEO_TITLE_MAX)
      seo.push(`SEO title is ${listing.seoTitle.length}/${SEO_TITLE_MAX} characters`);
    if (!listing.seoDescription.trim()) seo.push("meta description is empty");
    else if (listing.seoDescription.length > SEO_DESCRIPTION_MAX)
      seo.push(
        `meta description is ${listing.seoDescription.length}/${SEO_DESCRIPTION_MAX} characters`,
      );
    if (listing.handle.length > HANDLE_MAX)
      seo.push(`handle is ${listing.handle.length}/${HANDLE_MAX} characters`);
    add({
      id: "seo",
      label: "SEO lengths",
      status: seo.length ? "fail" : "pass",
      detail: seo.length
        ? `${seo.join("; ")}.`
        : `Title ${listing.seoTitle.length}/${SEO_TITLE_MAX}, description ${listing.seoDescription.length}/${SEO_DESCRIPTION_MAX}.`,
      step: "listing",
    });
  }

  // Contrast
  const palette = brand?.palette ?? null;
  const contrastFails = palette ? checkPalette(palette).filter((c) => c.required && !c.pass) : [];
  add({
    id: "contrast",
    label: "Colour contrast (WCAG AA)",
    status: palette && palettePassesAA(palette) ? "pass" : "fail",
    detail: !palette
      ? "No colour palette yet."
      : contrastFails.length
        ? contrastFails.map((c) => `${c.label}: ${c.ratio}:1 (needs ${c.min}:1)`).join("; ")
        : "Text and buttons meet 4.5:1.",
    step: "brand",
  });

  // Risk flags
  const blocks = (i.analysis?.riskFlags ?? []).filter(
    (f) => f.severity === "block" && !f.acknowledged,
  );
  add({
    id: "risk",
    label: "No unresolved blocking risk flags",
    status: blocks.length ? "fail" : "pass",
    detail: blocks.length
      ? `${plural(blocks.length, "blocking flag")}: ${blocks.map((f) => f.message).join(" · ")}`
      : i.analysis
        ? "Nothing blocking (or you've reviewed and accepted each one)."
        : "Analysis hasn't run, so nothing was flagged.",
    step: "analysis",
  });

  // Placeholders
  if (content) {
    const hits = findPlaceholders(content).filter((h) => !h.token.startsWith("[CONFIRM"));
    const tokens = [...new Set(hits.map((h) => h.token))];
    add({
      id: "placeholders",
      label: "Policy placeholders filled or acknowledged",
      status: !tokens.length || content.placeholdersAcknowledged ? "pass" : "fail",
      detail: !tokens.length
        ? "No placeholders left."
        : content.placeholdersAcknowledged
          ? `${plural(tokens.length, "placeholder")} left; you'll fill them in Shopify before launch.`
          : `${plural(tokens.length, "placeholder")} left (${tokens.slice(0, 4).join(", ")}${tokens.length > 4 ? "…" : ""}). Fill them, or confirm you'll fill them in Shopify.`,
      step: "content",
    });
  }

  if (listing) {
    // Price above cost
    const losing = listing.variants.filter(
      (v) => v.costPerItem != null && !(v.price > v.costPerItem),
    );
    const withCost = listing.variants.filter((v) => v.costPerItem != null).length;
    add({
      id: "margin",
      label: "Price above cost",
      status: losing.length ? "fail" : withCost ? "pass" : "warn",
      detail: losing.length
        ? losing
            .slice(0, 3)
            .map(
              (v) =>
                `${[v.option1, v.option2, v.option3].filter(Boolean).join(" / ")}: ${formatMoney(v.price, currency)} vs cost ${formatMoney(v.costPerItem!, currency)}`,
            )
            .join("; ")
        : withCost
          ? "Every variant with a cost is priced above it."
          : "No cost per item entered, so the margin can't be checked.",
      step: "listing",
    });

    // Variant matrix
    const variantErrors = validateVariants(listing.options, listing.variants);
    add({
      id: "variants",
      label: "Variant matrix valid",
      status: variantErrors.length ? "fail" : "pass",
      detail: variantErrors.length
        ? variantErrors.slice(0, 3).join(" ")
        : `${plural(listing.variants.length, "variant")}, ${plural(Math.max(1, listing.options.length), "option")}.`,
      step: "listing",
    });

    // Handle uniqueness
    const handles = [
      listing.handle,
      ...(content?.pages.map((p) => p.handle) ?? []),
      ...(content?.collections.map((c) => c.handle) ?? []),
    ];
    const dupInStore = content
      ? [
          ...new Set(
            [
              ...content.pages.map((p) => p.handle),
              ...content.collections.map((c) => c.handle),
            ].filter((h, k, arr) => arr.indexOf(h) !== k),
          ),
        ]
      : [];
    const validFormat = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(listing.handle);
    const otherProject = (i.otherHandles ?? []).includes(listing.handle);
    add({
      id: "handle",
      label: "Handle unique",
      status: !validFormat || dupInStore.length ? "fail" : otherProject ? "warn" : "pass",
      detail: !validFormat
        ? `"${listing.handle}" isn't a valid handle (lowercase letters, numbers, single dashes).`
        : dupInStore.length
          ? `Used twice in this store: ${dupInStore.join(", ")}.`
          : otherProject
            ? `Another StoreForge project also uses /products/${listing.handle}. Pushing both to one store would clash; change one handle.`
            : `/products/${listing.handle} and ${plural(handles.length - 1, "page/collection handle")} are unique.`,
      step: "listing",
    });

    // Facts to confirm (advisory)
    const confirm = [...listing.descriptionHtml.matchAll(/\[CONFIRM:\s*([^\]]+)\]/g)].map((m) =>
      m[1]!.trim(),
    );
    add({
      id: "confirm",
      label: "Facts confirmed",
      status: confirm.length ? "warn" : "pass",
      detail: confirm.length
        ? `${plural(confirm.length, "[CONFIRM] marker")} in the description: ${[...new Set(confirm)].slice(0, 4).join(", ")}. Check and remove them before publishing.`
        : "No [CONFIRM] markers left in the description.",
      step: "listing",
    });
  }

  const failed = items.filter((x) => x.status === "fail").length;
  return {
    ok: failed === 0,
    failed,
    warnings: items.filter((x) => x.status === "warn").length,
    items,
  };
}
