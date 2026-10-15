import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, getProject, updateProject } from "@/lib/db/projects";
import { prisma } from "@/lib/db/client";
import type { JobContext } from "@/lib/jobs/runner";
import { runExtract } from "@/lib/pipeline/extract";
import { scrapeUrl } from "@/lib/scrape";
import { detectWalls } from "@/lib/scrape/detect";
import { safeFetch } from "@/lib/scrape/http";
import { selectImageCandidates, upgradeCdnUrl } from "@/lib/scrape/images";
import { parsePriceText, parseProductHtml } from "@/lib/scrape/parse";
import { clearRobotsCache } from "@/lib/scrape/robots";
import {
  assertSafeUrl,
  BlockedUrlError,
  isBlockedAddress,
  type UrlPolicy,
} from "@/lib/scrape/ssrf";
import { startFixtureServer, type FixtureServer } from "../support/fixture-server";

let site: FixtureServer;
let policy: UrlPolicy;
const none: UrlPolicy = { allowlist: new Set() };

beforeAll(async () => {
  site = await startFixtureServer();
  policy = { allowlist: new Set([site.hostPort]) };
  process.env.SCRAPE_ALLOWLIST = site.hostPort;
});
afterAll(async () => {
  await site.close();
});

describe("SSRF guard", () => {
  it("rejects localhost, metadata IP, private IPs and non-http schemes", async () => {
    for (const url of [
      "http://localhost/",
      "http://localhost:3000/api/projects",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://127.0.0.1:8080/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://0.0.0.0/",
      "file:///etc/passwd",
      "ftp://example.com/file",
      "http://user:pass@example.com/",
    ]) {
      await expect(assertSafeUrl(url, none), url).rejects.toBeInstanceOf(BlockedUrlError);
    }
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("100.100.100.200")).toBe(true);
    expect(isBlockedAddress("fd00:ec2::254")).toBe(true);
  });

  it("does not fetch the fixture server unless it is allowlisted", async () => {
    await expect(safeFetch(`${site.origin}/product.html`, { policy: none })).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it("rejects redirects to private and metadata addresses", async () => {
    await expect(safeFetch(`${site.origin}/redirect-private`, { policy })).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    await expect(safeFetch(`${site.origin}/redirect-metadata`, { policy })).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    const ok = await safeFetch(`${site.origin}/redirect-ok`, { policy });
    expect(ok.status).toBe(200);
    expect(ok.finalUrl).toBe(`${site.origin}/product.html`);
  });

  it("returns a blocked_url warning from scrapeUrl instead of throwing", async () => {
    const r = await scrapeUrl("file:///etc/passwd", { policy: none, useBrowser: false });
    expect(r.warnings[0]?.code).toBe("blocked_url");
    const r2 = await scrapeUrl(`${site.origin}/redirect-metadata`, {
      policy,
      force: true,
      useBrowser: false,
    });
    expect(r2.warnings.map((w) => w.code)).toContain("blocked_url");
    expect(r2.title).toBeNull();
  });
});

describe("parsing", () => {
  it("parses prices in several formats", () => {
    expect(parsePriceText("$34.00")).toBe(34);
    expect(parsePriceText("€1.299,50")).toBe(1299.5);
    expect(parsePriceText("1,299.99 USD")).toBe(1299.99);
    expect(parsePriceText("free")).toBeNull();
  });

  it("extracts the fixture product from JSON-LD and DOM", async () => {
    const r = await scrapeUrl(`${site.origin}/product.html`, {
      policy,
      force: true,
      useBrowser: false,
    });
    expect(r.warnings.filter((w) => w.code !== "llm_fallback_unavailable")).toEqual([]);
    expect(r.title).toBe("Stoneware Pour-Over Coffee Dripper");
    expect(r.price).toEqual({ amount: 34, currency: "USD" });
    expect(r.brand).toBe("Kilnworks Supply Co.");
    expect(r.sku).toBe("KW-DRIP-02");
    expect(r.description).toContain("Hario V60");
    expect(r.specs["Capacity"]).toBe("1 to 2 cups (up to 400 ml brewed)");
    expect(r.options.map((o) => o.name)).toEqual(["Color", "Size"]);
    expect(r.options[0]!.values).toEqual(["Sand", "Sage", "Clay"]);
    expect(r.fetchMethod).toBe("static");
    expect(r.language).toBe("en");
    expect(r.shippingInfo).toBe(
      "Shipping: ships from our studio in Portland, Oregon within 3 business days.",
    );
    const urls = selectImageCandidates(r.images).map((c) => c.url);
    expect(urls.slice(0, 3)).toEqual(
      [1, 2, 3].map((n) => `${site.origin}/images/dripper-${n}.jpg`),
    );
    expect(urls.some((u) => u.includes("cart-icon"))).toBe(false);
  });

  it("detects CAPTCHA pages and does not try to bypass them", async () => {
    const r = await scrapeUrl(`${site.origin}/blocked`, { policy, force: true, useBrowser: false });
    expect(r.warnings.map((w) => w.code)).toContain("captcha");
    expect(r.title).toBeNull();
    expect(detectWalls("<p>Hello</p>", 200, "Hello")).toEqual([]);
  });

  it("respects robots.txt", async () => {
    clearRobotsCache();
    const r = await scrapeUrl(`${site.origin}/private/page.html`, { policy, force: true });
    expect(r.warnings.map((w) => w.code)).toEqual(["robots_disallowed"]);
    expect(r.fetchMethod).toBe("none");
  });

  it("uses the Shopify adapter for /products/<handle> pages", async () => {
    const r = await scrapeUrl(`${site.origin}/products/ceramic-mug`, {
      policy,
      force: true,
      useBrowser: false,
    });
    expect(r.adapter).toBe("shopify");
    expect(r.title).toBe("Speckled Ceramic Mug");
    expect(r.options).toEqual([
      { name: "Color", values: ["Oat", "Charcoal"] },
      { name: "Size", values: ["350 ml", "500 ml"] },
    ]);
    expect(r.variants).toHaveLength(4);
    expect(r.variants[2]).toMatchObject({
      sku: "MUG-CHA-350",
      price: 24,
      options: ["Charcoal", "350 ml"],
    });
    expect(r.price?.amount).toBe(24);
  });

  it("parses offers and options from inline HTML", () => {
    const p = parseProductHtml(
      `<html><head><meta property="og:title" content="OG Title"><meta property="og:image" content="/a.jpg"></head>
       <body><h1>Heading</h1><span class="price">£12.50</span></body></html>`,
      "https://shop.example/p",
    );
    expect(p.title).toBe("OG Title");
    expect(p.images[0]?.url).toBe("https://shop.example/a.jpg");
    expect(p.price?.amount).toBe(12.5);
    expect(p.price?.currency).toBe("GBP");
  });
});

describe("image candidates", () => {
  it("upgrades CDN thumbnails to originals", () => {
    expect(
      upgradeCdnUrl("https://cdn.shopify.com/s/files/1/0/p/mug_300x300.jpg?v=1&width=300"),
    ).toBe("https://cdn.shopify.com/s/files/1/0/p/mug.jpg?v=1");
    expect(upgradeCdnUrl("https://m.media-amazon.com/images/I/81abc._AC_SX300_SY300_.jpg")).toBe(
      "https://m.media-amazon.com/images/I/81abc.jpg",
    );
    expect(upgradeCdnUrl("https://ae01.alicdn.com/kf/Habc.jpg_220x220.jpg")).toBe(
      "https://ae01.alicdn.com/kf/Habc.jpg",
    );
    expect(upgradeCdnUrl("https://i.etsystatic.com/1/r/il/abc/123/il_340x270.123_abc.jpg")).toBe(
      "https://i.etsystatic.com/1/r/il/abc/123/il_fullxfull.123_abc.jpg",
    );
    expect(upgradeCdnUrl("https://shop.example/wp-content/uploads/2024/01/mug-300x300.jpg")).toBe(
      "https://shop.example/wp-content/uploads/2024/01/mug.jpg",
    );
  });

  it("filters icons, tracking pixels and tiny images, dedupes, and keeps source priority", () => {
    const c = selectImageCandidates([
      { url: "https://x.test/img/logo.png", alt: "", width: null, height: null, source: "img" },
      { url: "https://www.facebook.com/tr?id=1", alt: "", width: 1, height: 1, source: "img" },
      { url: "https://x.test/small.jpg", alt: "", width: 100, height: 100, source: "img" },
      { url: "https://x.test/a.jpg", alt: "", width: null, height: null, source: "img" },
      { url: "https://x.test/a.jpg", alt: "", width: null, height: null, source: "jsonld" },
      { url: "https://x.test/b.svg", alt: "", width: null, height: null, source: "og" },
      { url: "https://x.test/c.jpg", alt: "", width: null, height: null, source: "og" },
    ]);
    expect(c.map((x) => [x.url, x.source])).toEqual([
      ["https://x.test/a.jpg", "jsonld"],
      ["https://x.test/c.jpg", "og"],
    ]);
  });
});

describe("extract job", () => {
  it("stores extractions and downloads product images as third-party assets", async () => {
    const p = await createProject("Extract");
    await updateProject(p.id, {
      inputs: {
        urls: [`${site.origin}/product.html`],
        context: (await getProject(p.id)).inputs.context,
      },
    });
    const messages: string[] = [];
    const ctx: JobContext = {
      jobId: "test",
      projectId: p.id,
      type: "extract",
      payload: {},
      progress: async (_s, _p, m) => void messages.push(m),
    };
    const out = await runExtract(ctx, { force: true });
    expect(out[0]?.title).toBe("Stoneware Pour-Over Coffee Dripper");
    const assets = await prisma.asset.findMany({
      where: { projectId: p.id },
      orderBy: { position: "asc" },
    });
    expect(assets).toHaveLength(3);
    expect(assets.every((a) => a.origin === "scraped" && a.width === 1200)).toBe(true);
    expect(assets.every((a) => a.flags.includes("third_party_source"))).toBe(true);
    expect((await getProject(p.id)).extractions[0]?.sku).toBe("KW-DRIP-02");
    expect(messages.some((m) => m.includes("Added 3 images"))).toBe(true);
  });
});

const chromium = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
describe.runIf(existsSync(chromium))("headless browser fallback", () => {
  it("renders a JS-only page when static HTML is thin", async () => {
    process.env.CHROMIUM_PATH = chromium;
    const r = await scrapeUrl(`${site.origin}/js-rendered.html`, { policy, force: true });
    expect(r.fetchMethod).toBe("browser");
    expect(r.title).toBe("Linen Throw Pillow Cover");
    expect(r.price?.amount).toBe(29);
  }, 60_000);
});
