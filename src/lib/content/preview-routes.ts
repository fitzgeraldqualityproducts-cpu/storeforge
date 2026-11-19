import type { ProductListing, StoreContent } from "@/lib/schemas";

/** Product page path for the preview, matching the Shopify URL the product will get. */
export function productPath(listing: Pick<ProductListing, "handle"> | null) {
  return `/products/${listing?.handle || "product"}`;
}

export type PreviewRoute =
  | { kind: "home" }
  | { kind: "product" }
  | { kind: "collection"; title: string; descriptionHtml: string }
  | { kind: "search" }
  | { kind: "page"; title: string; bodyHtml: string }
  | { kind: "missing" };

/** Resolve a storefront path ("/", "/products/x", "/pages/about-us"…) to what the preview shows. */
export function resolvePreviewRoute(path: string, content: StoreContent): PreviewRoute {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (clean === "/") return { kind: "home" };
  if (clean.startsWith("/products/")) return { kind: "product" };
  if (clean === "/search") return { kind: "search" };
  if (clean === "/collections" || clean.startsWith("/collections/")) {
    const handle = clean.split("/")[2] ?? "all";
    const c = content.collections.find((x) => x.handle === handle);
    return {
      kind: "collection",
      title: c?.title ?? "All products",
      descriptionHtml: c?.descriptionHtml ?? "",
    };
  }
  const m = /^\/(pages|policies)\/([^/]+)$/.exec(clean);
  if (m) {
    const page = content.pages.find((p) => p.handle === m[2]);
    if (page) return { kind: "page", title: page.title, bodyHtml: page.bodyHtml };
  }
  return { kind: "missing" };
}
