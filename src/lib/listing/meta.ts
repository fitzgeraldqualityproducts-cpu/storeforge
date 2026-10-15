import { findViolationsDeep } from "@/lib/guardrails";
import { ListingMeta, type ProductListing } from "@/lib/schemas";
import { confirmMarkers } from "./text";

/** Derived listing facts recomputed after every generation or edit. */
export function refreshListingMeta(listing: ProductListing, base: ListingMeta | null): ListingMeta {
  const meta = base ?? ListingMeta.parse({});
  const violations = findViolationsDeep({
    title: listing.title,
    tags: listing.tags,
    descriptionHtml: listing.descriptionHtml,
    seoTitle: listing.seoTitle,
    seoDescription: listing.seoDescription,
  }).map((v) => `${v.path}: "${v.match}" (${v.message})`);
  return {
    ...meta,
    confirmMarkers: confirmMarkers(
      listing.title,
      listing.descriptionHtml,
      listing.seoTitle,
      listing.seoDescription,
    ),
    guardrailViolations: violations,
  };
}
