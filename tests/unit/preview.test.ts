import { describe, expect, it } from "vitest";
import { fixtureContent } from "@/lib/ai/fixtures/content";
import { productPath, resolvePreviewRoute } from "@/lib/content/preview-routes";
import { normalizeContent } from "@/lib/content/structure";
import type { StoreContent } from "@/lib/schemas";

function sampleContent(): StoreContent {
  const base = fixtureContent({
    id: "x",
    name: "x",
    inputs: { urls: [], context: {} },
    extractions: [],
    analysis: null,
    brandKit: null,
    listing: null,
  } as never);
  return normalizeContent(
    {
      ...base,
      menus: { main: [], footer: [] },
      settings: {
        storeName: "",
        currency: "USD",
        tagline: "",
        socialLinks: { instagram: "", facebook: "", tiktok: "", pinterest: "", youtube: "" },
        checkoutNotes: [],
      },
      placeholdersAcknowledged: false,
    } as StoreContent,
    { productHandle: "dripper", storeName: "Shop", currency: "USD", tagline: "" },
  );
}

describe("store preview navigation", () => {
  const content = sampleContent();

  it("every menu link and the hero button open a real page in the preview", () => {
    const links = [...content.menus.main, ...content.menus.footer].map((m) => m.url);
    const hero = content.homepageSections.find((s) => s.type === "hero");
    if (hero?.type === "hero") links.push(hero.ctaLink);
    expect(links.length).toBeGreaterThan(5);
    for (const url of links) {
      expect(resolvePreviewRoute(url, content).kind, url).not.toBe("missing");
    }
  });

  it("resolves pages, policies, collections and the product", () => {
    expect(resolvePreviewRoute("/", content)).toEqual({ kind: "home" });
    expect(resolvePreviewRoute(productPath({ handle: "dripper" }), content).kind).toBe("product");
    expect(productPath(null)).toBe("/products/product");
    const about = resolvePreviewRoute("/pages/about-us/", content);
    expect(about.kind === "page" && about.title).toBe("About us");
    const refund = resolvePreviewRoute("/policies/refund-policy", content);
    expect(refund.kind).toBe("page");
    const all = resolvePreviewRoute("/collections/all?sort=new", content);
    expect(all.kind).toBe("collection");
    expect(resolvePreviewRoute("/search", content).kind).toBe("search");
    expect(resolvePreviewRoute("/pages/nope", content).kind).toBe("missing");
  });
});
