import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { getProject } from "@/lib/db/projects";
import type { JobContext } from "@/lib/jobs/runner";
import { runContent } from "@/lib/pipeline/content";
import { ShopifyPushResult, type ProductListing, type StoreContent } from "@/lib/schemas";
import {
  createAdminClient,
  normalizeShopDomain,
  ShopifyError,
  throttleWaitMs,
} from "@/lib/shopify/client";
import {
  productMatchesRules,
  pushToShopify,
  type PushImage,
  type PushInput,
} from "@/lib/shopify/push";
import { runShopifyPush } from "@/lib/shopify/run";
import { clearForJob, openCredentials, sealCredentials, stashForJob } from "@/lib/shopify/session";
import { dripperProject } from "../support/dripper";
import { createMockShopify, type MockShopifyOptions } from "../support/shopify-mock";

const TOKEN = "shpat_test_0123456789abcdef";
const noSleep = vi.fn(async () => undefined);

function clientFor(mock: ReturnType<typeof createMockShopify>) {
  return createAdminClient({
    domain: "mock-store.myshopify.com",
    token: TOKEN,
    apiVersion: "2026-10",
    fetchImpl: mock.fetch,
    sleep: noSleep,
  });
}

const listing: ProductListing = {
  title: "Stoneware Pour-Over Dripper",
  handle: "stoneware-dripper",
  vendor: "Linden Coffee",
  productType: "Coffee Dripper",
  shopifyCategory: "",
  tags: ["coffee", "pour-over"],
  descriptionHtml: "<p>Hand-glazed stoneware.</p>",
  seoTitle: "Stoneware Pour-Over Dripper",
  seoDescription: "A hand-glazed stoneware dripper.",
  options: [{ name: "Color", values: ["Sand", "Sage"] }],
  variants: [
    { option1: "Sand", sku: "LC-SAND", price: 34, grams: 420, inventoryQty: 5, costPerItem: 9 },
    { option1: "Sage", sku: "LC-SAGE", price: 34, grams: 420, inventoryQty: 3, compareAtPrice: 40 },
  ],
  status: "draft",
};

const page = (handle: string, title: string, kind: StoreContent["pages"][number]["kind"]) => ({
  handle,
  title,
  kind,
  bodyHtml: `<p>${title} for [BUSINESS NAME].</p>`,
});

const content: StoreContent = {
  announcementBar: "Free shipping over $50",
  homepageSections: [{ type: "featured_product", heading: "Meet the dripper" }],
  pages: [
    page("about-us", "About us", "about"),
    page("contact", "Contact", "contact"),
    page("faq", "FAQ", "faq"),
    page("shipping-policy", "Shipping policy", "policy"),
    page("refund-policy", "Refund policy", "policy"),
    page("privacy-policy", "Privacy policy", "policy"),
    page("terms-of-service", "Terms of service", "policy"),
  ],
  collections: [
    { handle: "all", title: "All Products", descriptionHtml: "", rules: null },
    {
      handle: "pour-over",
      title: "Pour-over",
      descriptionHtml: "<p>Brewers.</p>",
      rules: {
        appliedDisjunctively: false,
        rules: [{ column: "TAG", relation: "EQUALS", condition: "pour-over" }],
      },
    },
  ],
  menus: {
    main: [
      { title: "Home", url: "/", type: "FRONTPAGE", handle: null },
      { title: "Shop", url: "/collections/all", type: "COLLECTION", handle: "all" },
      {
        title: "Pour-over",
        url: "/collections/pour-over",
        type: "COLLECTION",
        handle: "pour-over",
      },
      { title: "About", url: "/pages/about-us", type: "PAGE", handle: "about-us" },
    ],
    footer: [
      { title: "Search", url: "/search", type: "SEARCH", handle: null },
      {
        title: "Refund policy",
        url: "/policies/refund-policy",
        type: "SHOP_POLICY",
        handle: "refund-policy",
      },
    ],
  },
  settings: {
    storeName: "Linden Coffee",
    currency: "USD",
    tagline: "",
    socialLinks: { instagram: "", facebook: "", tiktok: "", pinterest: "", youtube: "" },
    checkoutNotes: [],
  },
  placeholdersAcknowledged: true,
};

const images: PushImage[] = [1, 2, 3].map((n) => ({
  assetId: `asset-${n}`,
  fileName: `stoneware-dripper-${n}.webp`,
  alt: `Dripper photo ${n}`,
  variantKey: n === 2 ? "Color:Sage" : null,
  mimeType: "image/webp",
  size: 4,
  read: async () => Buffer.from([1, 2, 3, n]),
}));

const input: PushInput = {
  listing,
  content,
  storeName: "Linden Coffee",
  images,
  themeFiles: { "templates/index.json": "{}\n", "config/settings_data.json": "{}\n" },
};

const live = { dryRun: false, includeTheme: false, themeId: null, sleep: noSleep };
const statusOf = (r: ShopifyPushResult, step: string) => r.steps.find((s) => s.step === step)!;

describe("Shopify client", () => {
  it("only accepts myshopify.com store addresses", () => {
    expect(normalizeShopDomain("Linden-Coffee")).toBe("linden-coffee.myshopify.com");
    expect(normalizeShopDomain("https://linden-coffee.myshopify.com/admin")).toBe(
      "linden-coffee.myshopify.com",
    );
    expect(normalizeShopDomain("https://admin.shopify.com/store/linden-coffee/products")).toBe(
      "linden-coffee.myshopify.com",
    );
    for (const bad of [
      "evil.com",
      "linden.myshopify.com.evil.com",
      "127.0.0.1",
      "linden.myshopify.com:8080",
      "",
    ]) {
      expect(() => normalizeShopDomain(bad)).toThrow(ShopifyError);
    }
  });

  it("backs off on THROTTLED using the reported cost, then succeeds", async () => {
    const mock = createMockShopify({ throttleFirst: 2 });
    const sleep = vi.fn(async () => undefined);
    const client = createAdminClient({
      domain: "mock-store",
      token: TOKEN,
      apiVersion: "2026-10",
      fetchImpl: mock.fetch,
      sleep,
    });
    const data = await client.request<{ shop: { name: string } }>(
      "query StoreForgeVerify { shop { name } }",
    );
    expect(data.shop.name).toBe("Mock Store");
    expect(mock.calls).toHaveLength(3);
    // (requested 50 - available 10) / restoreRate 100 per second = 400 ms.
    expect(sleep).toHaveBeenCalledWith(400);
    expect(mock.calls[0]!.headers["x-shopify-access-token"]).toBe(TOKEN);
    expect(
      throttleWaitMs({
        requestedQueryCost: 500,
        actualQueryCost: null,
        throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 },
      }),
    ).toBe(4000);
  });

  it("explains a rejected token without ever echoing it", async () => {
    const mock = createMockShopify({ httpStatus: 401 });
    const err = await clientFor(mock)
      .request("query StoreForgeVerify { shop { name } }")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyError);
    expect((err as Error).message).toMatch(/rejected the access token/);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe("session-only credentials", () => {
  it("seals the token into an opaque cookie value and rejects tampering and expiry", () => {
    const sealed = sealCredentials("mock-store.myshopify.com", TOKEN);
    expect(sealed).not.toContain(TOKEN);
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("shpat");
    expect(openCredentials(sealed)).toEqual({
      domain: "mock-store.myshopify.com",
      token: TOKEN,
      source: "session",
    });
    const bytes = Buffer.from(sealed, "base64url");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    expect(openCredentials(bytes.toString("base64url"))).toBeNull();
    expect(openCredentials(sealed, Date.now() + 9 * 60 * 60 * 1000)).toBeNull();
    expect(openCredentials("garbage")).toBeNull();
  });
});

describe("Shopify push", () => {
  it("dry-run validates the connection and lists the plan without changing anything", async () => {
    const mock = createMockShopify();
    const r = await pushToShopify(clientFor(mock), input, { ...live, dryRun: true });
    expect(mock.mutations()).toEqual([]);
    expect(statusOf(r, "shop").status).toBe("succeeded");
    for (const s of [
      "images",
      "product",
      "inventory",
      "collections",
      "pages",
      "policies",
      "menus",
    ]) {
      expect(statusOf(r, s).status).toBe("planned");
    }
    expect(statusOf(r, "theme").status).toBe("skipped");
    const plan = r.plannedOperations.join("\n");
    expect(plan).toMatch(
      /Create product "Stoneware Pour-Over Dripper".*as DRAFT with 2 variants and 3 images/,
    );
    expect(plan).toMatch(/Upload 3 images/);
    expect(plan).toMatch(/smart collection "Pour-over".*matches its rules/);
    expect(plan).toMatch(/Create hidden page "About us"/);
    expect(plan).toMatch(/refund policy in Settings → Policies/);
    expect(plan).toMatch(/Replace the items in your "Main menu"/);
    expect(r.themes.map((t) => t.name)).toEqual(["Dawn copy"]);
  });

  it("creates a draft product with images, variants, inventory, collections, pages, policies and menus", async () => {
    const mock = createMockShopify();
    const r = await pushToShopify(clientFor(mock), input, live);
    for (const s of [
      "shop",
      "images",
      "product",
      "inventory",
      "collections",
      "pages",
      "policies",
      "menus",
    ]) {
      expect(statusOf(r, s), s).toMatchObject({ status: "succeeded", errors: [] });
    }
    const [product] = mock.state.products;
    expect(mock.state.products).toHaveLength(1);
    expect(product!.status).toBe("DRAFT");
    expect(product!.media.map((m) => m.alt)).toEqual([
      "Dripper photo 1",
      "Dripper photo 2",
      "Dripper photo 3",
    ]);
    expect(mock.state.uploads.map((u) => u.fileName)).toEqual(images.map((i) => i.fileName));
    // The Sage variant shows the image mapped to Color:Sage.
    const sage = product!.variants.find((v) => v.selectedOptions[0]!.value === "Sage")!;
    expect(sage.file).toBe(product!.media[1]!.id);
    const variantInput = (product!.input.variants as Record<string, unknown>[])[1]!;
    expect(variantInput).toMatchObject({
      price: "34.00",
      compareAtPrice: "40.00",
      inventoryPolicy: "DENY",
      inventoryItem: { tracked: true, measurement: { weight: { value: 420, unit: "GRAMS" } } },
    });
    expect([...mock.state.inventory.values()].sort()).toEqual([3, 5]);
    expect(mock.state.collections).toHaveLength(1);
    expect(mock.state.collections[0]!.input.ruleSet).toEqual({
      appliedDisjunctively: false,
      rules: [{ column: "TAG", relation: "EQUALS", condition: "pour-over" }],
    });
    expect(mock.state.pages.map((p) => [p.handle, p.isPublished])).toEqual([
      ["about-us", false],
      ["contact", false],
      ["faq", false],
    ]);
    expect([...mock.state.policies.keys()].sort()).toEqual([
      "PRIVACY_POLICY",
      "REFUND_POLICY",
      "SHIPPING_POLICY",
      "TERMS_OF_SERVICE",
    ]);
    const main = mock.state.menus.find((m) => m.handle === "main-menu")!;
    expect(main.items).toEqual([
      { title: "Home", type: "FRONTPAGE", url: "/" },
      { title: "Shop", type: "HTTP", url: "/collections/all" },
      { title: "Pour-over", type: "COLLECTION", resourceId: mock.state.collections[0]!.id },
      { title: "About", type: "PAGE", resourceId: mock.state.pages[0]!.id },
    ]);
    const footer = mock.state.menus.find((m) => m.handle === "footer")!;
    expect(footer.items[1]).toEqual({
      title: "Refund policy",
      type: "SHOP_POLICY",
      resourceId: mock.state.policies.get("REFUND_POLICY")!.id,
    });
    expect(r.resources.productId).toBe(product!.id);
    expect(Object.keys(r.resources.fileIds)).toEqual(["asset-1", "asset-2", "asset-3"]);
  });

  it("is idempotent: a second push updates the same resources and keeps the merchant's status", async () => {
    const mock = createMockShopify();
    const first = await pushToShopify(clientFor(mock), input, live);
    mock.state.products[0]!.status = "ACTIVE"; // the merchant published it in Shopify
    const second = await pushToShopify(
      clientFor(mock),
      { ...input, listing: { ...listing, title: "Stoneware Dripper (v2)" } },
      live,
      { resources: first.resources },
    );
    expect(second.steps.every((s) => s.status !== "failed")).toBe(true);
    expect(mock.state.products).toHaveLength(1);
    expect(mock.state.products[0]!.title).toBe("Stoneware Dripper (v2)");
    expect(mock.state.products[0]!.status).toBe("ACTIVE");
    expect(mock.state.uploads).toHaveLength(3); // nothing re-uploaded
    expect(mock.state.products[0]!.media).toHaveLength(3);
    expect(mock.state.collections).toHaveLength(1);
    expect(mock.state.pages).toHaveLength(3);
    expect(mock.state.menus).toHaveLength(2);
    expect(second.resources).toEqual(first.resources);
    const ops = mock.mutations().map((c) => c.operation);
    expect(ops.filter((o) => o === "StoreForgeCollectionUpdate")).toHaveLength(1);
    expect(ops.filter((o) => o === "StoreForgePageUpdate")).toHaveLength(3);
  });

  it("never overwrites a product with the same handle that StoreForge didn't create", async () => {
    const mock = createMockShopify();
    mock.state.products.push({
      id: "gid://shopify/Product/1",
      handle: "stoneware-dripper",
      title: "Merchant's own product",
      status: "ACTIVE",
      input: {},
      media: [],
      variants: [],
    });
    const r = await pushToShopify(clientFor(mock), input, live);
    expect(statusOf(r, "product").status).toBe("failed");
    expect(statusOf(r, "product").errors[0]).toMatch(/already exists.*won't be overwritten/);
    expect(statusOf(r, "inventory").status).toBe("skipped");
    expect(mock.state.products[0]!.title).toBe("Merchant's own product");
    expect(mock.state.uploads).toHaveLength(0);
    // Steps that don't depend on the product still ran.
    expect(statusOf(r, "pages").status).toBe("succeeded");
  });

  it("saves policies as hidden pages when the token lacks the legal-policies scopes", async () => {
    const mock = createMockShopify({ noPolicyScope: true });
    const r = await pushToShopify(clientFor(mock), input, live);
    expect(statusOf(r, "policies")).toMatchObject({ status: "succeeded" });
    expect(statusOf(r, "policies").detail).toMatch(/hidden pages.*write_legal_policies/);
    expect(mock.state.pages.map((p) => p.handle)).toEqual([
      "about-us",
      "contact",
      "faq",
      "shipping-policy",
      "refund-policy",
      "privacy-policy",
      "terms-of-service",
    ]);
    const footer = mock.state.menus.find((m) => m.handle === "footer")!;
    expect(footer.items[1]).toMatchObject({ type: "PAGE", resourceId: mock.state.pages[4]!.id });
  });

  it("reports userErrors per step, keeps going, and retries only the failed step", async () => {
    const mock = createMockShopify({ pageCreateErrors: 1 });
    const first = await pushToShopify(clientFor(mock), input, live);
    expect(statusOf(first, "pages").status).toBe("failed");
    expect(statusOf(first, "pages").errors[0]).toBe(
      "About us: pageCreate: page.body: Body is invalid",
    );
    expect(statusOf(first, "menus").status).toBe("succeeded");
    const before = mock.mutations().length;
    const retry = await pushToShopify(
      clientFor(mock),
      input,
      { ...live, onlySteps: ["pages"] },
      { resources: first.resources, steps: first.steps },
    );
    expect(statusOf(retry, "pages").status).toBe("succeeded");
    expect(statusOf(retry, "product").status).toBe("succeeded"); // carried over, not re-run
    const retryOps = mock
      .mutations()
      .slice(before)
      .map((c) => c.operation);
    expect(new Set(retryOps)).toEqual(new Set(["StoreForgePageCreate", "StoreForgePageUpdate"]));
    expect(mock.state.pages).toHaveLength(3);
  });

  it("writes theme files only to an unpublished theme, never the live one", async () => {
    const mock = createMockShopify({ themeProcessingPolls: 2 });
    const refused = await pushToShopify(clientFor(mock), input, {
      ...live,
      includeTheme: true,
      themeId: "gid://shopify/OnlineStoreTheme/1",
      onlySteps: ["theme"],
    });
    expect(statusOf(refused, "theme").status).toBe("failed");
    expect(statusOf(refused, "theme").errors[0]).toMatch(/live theme/);
    expect(mock.state.themes[0]!.files).toEqual({});

    const created = await pushToShopify(clientFor(mock), input, {
      ...live,
      includeTheme: true,
      onlySteps: ["theme"],
      themePoll: { intervalMs: 1, attempts: 5 },
    });
    expect(statusOf(created, "theme").status).toBe("succeeded");
    const theme = mock.state.themes.find((t) => t.name === "Linden Coffee (StoreForge)")!;
    expect(theme.role).toBe("UNPUBLISHED");
    expect(Object.keys(theme.files)).toEqual(["templates/index.json", "config/settings_data.json"]);
    const createCall = mock.calls.find((c) => c.operation === "StoreForgeThemeCreate")!;
    expect(createCall.variables.source).toMatch(/^https:\/\/github\.com\/Shopify\/dawn\/archive/);
  });

  it("knows whether the product lands in a smart collection", () => {
    const rules = (
      column: "TAG" | "VARIANT_PRICE",
      relation: "EQUALS" | "GREATER_THAN",
      condition: string,
    ) => ({
      appliedDisjunctively: false,
      rules: [{ column, relation, condition }],
    });
    expect(productMatchesRules(listing, rules("TAG", "EQUALS", "Coffee"))).toBe(true);
    expect(productMatchesRules(listing, rules("TAG", "EQUALS", "tea"))).toBe(false);
    expect(productMatchesRules(listing, rules("VARIANT_PRICE", "GREATER_THAN", "30"))).toBe(true);
  });
});

describe("export_shopify job", () => {
  const ctxFor = (projectId: string, payload: Record<string, unknown>): JobContext => ({
    jobId: "t",
    projectId,
    type: "export_shopify",
    payload,
    progress: async () => undefined,
  });

  async function withMockFetch<T>(
    mockOpts: MockShopifyOptions,
    fn: (m: ReturnType<typeof createMockShopify>) => Promise<T>,
  ) {
    const mock = createMockShopify(mockOpts);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(mock.fetch);
    try {
      return await fn(mock);
    } finally {
      spy.mockRestore();
    }
  }

  it("runs dry-run then a confirmed push for a real project, saving GIDs on one ExportRecord", async () => {
    const p = await dripperProject("Shopify push");
    await runContent(ctxFor(p.id, {}));
    const domain = "mock-store.myshopify.com";
    await withMockFetch({}, async (mock) => {
      stashForJob(p.id, { domain, token: TOKEN, source: "session" });
      const dry = (await runShopifyPush(ctxFor(p.id, { dryRun: true, storeDomain: domain }))) as {
        result: ShopifyPushResult;
      };
      expect(mock.mutations()).toEqual([]);
      expect(dry.result.plannedOperations.length).toBeGreaterThan(5);
      expect(await prisma.exportRecord.count({ where: { projectId: p.id, type: "shopify" } })).toBe(
        0,
      );

      // The vault is cleared after each job: a push needs the token handed over again.
      await expect(
        runShopifyPush(ctxFor(p.id, { dryRun: false, confirm: true, storeDomain: domain })),
      ).rejects.toThrow(/session for mock-store\.myshopify\.com has ended/);

      for (let i = 0; i < 2; i++) {
        stashForJob(p.id, { domain, token: TOKEN, source: "session" });
        const res = (await runShopifyPush(
          ctxFor(p.id, { dryRun: false, confirm: true, storeDomain: domain }),
        )) as { ok: boolean; failed: string[] };
        expect(res.failed).toEqual([]);
      }
      expect(mock.state.products).toHaveLength(1);
      expect(mock.state.products[0]!.status).toBe("DRAFT");
      expect(mock.state.products[0]!.media).toHaveLength(3);
      const rows = await prisma.exportRecord.findMany({
        where: { projectId: p.id, type: "shopify" },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.storeDomain).toBe(domain);
      const saved = ShopifyPushResult.parse(JSON.parse(rows[0]!.shopifyResult!));
      expect(saved.resources.productId).toBe(mock.state.products[0]!.id);
      // The token never reaches the database.
      const job = JSON.stringify(rows) + JSON.stringify(await getProject(p.id));
      expect(job).not.toContain(TOKEN);
    });
    clearForJob(p.id);
  });
});
