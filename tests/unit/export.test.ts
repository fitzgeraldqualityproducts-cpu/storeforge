import AdmZip from "adm-zip";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildProductCsv, csvCell, type CsvImage } from "@/lib/export/csv";
import {
  csvHeaders,
  csvKeyMap,
  CSV_KEYS,
  SHOPIFY_CSV_HEADERS_CURRENT,
  SHOPIFY_CSV_HEADERS_LEGACY,
} from "@/lib/export/csv-format";
import { validateProductCsv } from "@/lib/export/csv-validate";
import { buildDawnTheme, validateDawnTheme } from "@/lib/export/theme";
import { getProject } from "@/lib/db/projects";
import type { JobContext } from "@/lib/jobs/runner";
import { prisma } from "@/lib/db/client";
import { runExportBundle } from "@/lib/export/bundle";
import { runContent } from "@/lib/pipeline/content";
import { runListing } from "@/lib/pipeline/listing";
import { fromDataRelative } from "@/lib/security/paths";
import type { ProductListing } from "@/lib/schemas";
import { dripperProject } from "../support/dripper";

const ctxFor = (projectId: string, payload: Record<string, unknown> = {}): JobContext => ({
  jobId: "t",
  projectId,
  type: "export_bundle",
  payload,
  progress: async () => undefined,
});

/** The column list given in the StoreForge spec (Section 8), i.e. the legacy template. */
const SPEC_COLUMNS =
  "Handle, Title, Body (HTML), Vendor, Product Category, Type, Tags, Published, Option1 Name, Option1 Value, Option2 Name, Option2 Value, Option3 Name, Option3 Value, Variant SKU, Variant Grams, Variant Inventory Tracker, Variant Inventory Qty, Variant Inventory Policy, Variant Fulfillment Service, Variant Price, Variant Compare At Price, Variant Requires Shipping, Variant Taxable, Variant Barcode, Image Src, Image Position, Image Alt Text, Gift Card, SEO Title, SEO Description, Variant Image, Variant Weight Unit, Cost per item, Status".split(
    ", ",
  );

const listing: ProductListing = {
  title: 'Stoneware "Pour-Over" Dripper, 2 cups',
  handle: "stoneware-dripper",
  vendor: "Linden Coffee",
  productType: "Coffee Dripper",
  shopifyCategory: "Home & Garden > Kitchen & Dining > Coffee & Tea",
  tags: ["coffee", "stoneware"],
  descriptionHtml: "<p>Line one,\nline two.</p><ul><li>Hand-glazed</li></ul>",
  seoTitle: "Stoneware Dripper | Linden Coffee",
  seoDescription: "A stoneware pour-over dripper.",
  options: [
    { name: "Color", values: ["Sand", "Sage"] },
    { name: "Size", values: ["1-2 cups", "2-4 cups"] },
  ],
  variants: [
    { option1: "Sand", option2: "1-2 cups", sku: "LC-1", price: 34, grams: 420, inventoryQty: 5 },
    {
      option1: "Sand",
      option2: "2-4 cups",
      sku: "LC-2",
      price: 38,
      grams: 480,
      inventoryQty: 0,
      compareAtPrice: 42,
    },
    {
      option1: "Sage",
      option2: "1-2 cups",
      sku: "LC-3",
      price: 34,
      grams: 420,
      inventoryQty: 0,
      costPerItem: 9.5,
    },
    {
      option1: "Sage",
      option2: "2-4 cups",
      sku: "LC-4",
      price: 38,
      grams: 1200,
      inventoryQty: 0,
      barcode: "0123",
    },
  ],
  status: "draft",
};
const images: CsvImage[] = [1, 2, 3].map((n) => ({
  assetId: `a${n}`,
  fileName: `stoneware-dripper-${n}.webp`,
  url: `https://cdn.example.com/stoneware-dripper-${n}.webp`,
  alt: n === 1 ? "Sand dripper, front" : `View ${n}`,
  variantKey: n === 2 ? "Color:Sage" : null,
}));

const parse = (csv: string) => Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;

describe("CSV header constants", () => {
  it("encodes the legacy template exactly as the spec lists it", () => {
    expect([...SHOPIFY_CSV_HEADERS_LEGACY]).toEqual(SPEC_COLUMNS);
  });

  it("encodes Shopify's current template names", () => {
    expect(SHOPIFY_CSV_HEADERS_CURRENT.slice(0, 3)).toEqual(["Title", "URL handle", "Description"]);
    expect(SHOPIFY_CSV_HEADERS_CURRENT).toContain("Barcodes");
    expect(SHOPIFY_CSV_HEADERS_CURRENT).toContain("Option1 LinkedTo");
    expect(new Set(SHOPIFY_CSV_HEADERS_CURRENT).size).toBe(SHOPIFY_CSV_HEADERS_CURRENT.length);
  });

  it("maps every header of both formats to a column key", () => {
    for (const f of ["current", "legacy"] as const) {
      const map = csvKeyMap(f);
      expect(Object.keys(map).sort()).toEqual([...csvHeaders(f)].sort());
      for (const k of Object.values(map)) expect(CSV_KEYS).toContain(k);
    }
    // Everything except the LinkedTo columns exists in both formats.
    const legacyKeys = new Set(Object.values(csvKeyMap("legacy")));
    expect(CSV_KEYS.filter((k) => !legacyKeys.has(k)).sort()).toEqual([
      "option1Linked",
      "option2Linked",
      "option3Linked",
    ]);
  });
});

describe("CSV builder", () => {
  it("escapes quotes, commas and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(" padded")).toBe('" padded"');
  });

  for (const format of ["current", "legacy"] as const) {
    it(`writes a valid ${format} CSV: one row per variant, then image rows`, () => {
      const { csv } = buildProductCsv(listing, images, { format, withImages: true });
      expect(csv.charCodeAt(0)).not.toBe(0xfeff);
      const data = parse(csv);
      const header = data[0]!;
      expect(header).toEqual([...csvHeaders(format)]);
      expect(data).toHaveLength(1 + 4 + 2);
      const col = (row: string[], key: string) => row[header.indexOf(key)];
      const H =
        format === "current"
          ? {
              handle: "URL handle",
              body: "Description",
              price: "Price",
              img: "Product image URL",
              pos: "Image position",
              vimg: "Variant image URL",
              compare: "Compare-at price",
              o1: "Option1 name",
              pub: "Published on online store",
              grams: "Weight value (grams)",
            }
          : {
              handle: "Handle",
              body: "Body (HTML)",
              price: "Variant Price",
              img: "Image Src",
              pos: "Image Position",
              vimg: "Variant Image",
              compare: "Variant Compare At Price",
              o1: "Option1 Name",
              pub: "Published",
              grams: "Variant Grams",
            };
      const [first, second, third, , img2, img3] = data.slice(1);
      expect(col(first!, "Title")).toBe(listing.title);
      expect(col(first!, H.body)).toBe(listing.descriptionHtml); // newline survived quoting
      expect(col(first!, H.o1)).toBe("Color");
      expect(col(first!, H.pub)).toBe("TRUE");
      expect(col(first!, "Status")).toBe("draft");
      expect(col(first!, H.price)).toBe("34.00");
      expect(col(first!, H.img)).toBe(images[0]!.url);
      expect(col(first!, H.pos)).toBe("1");
      expect(col(second!, "Title")).toBe("");
      expect(col(second!, H.compare)).toBe("42.00");
      expect(col(third!, H.vimg)).toBe(images[1]!.url); // Sage → mapped image
      expect(col(img2!, H.handle)).toBe("stoneware-dripper");
      expect(col(img2!, H.pos)).toBe("2");
      expect(col(img3!, H.pos)).toBe("3");
      expect(col(img3!, H.price)).toBe("");
      expect(col(data[4]!, H.grams)).toBe("1200");
      const report = validateProductCsv(csv, format);
      expect(report.issues).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.format).toBe(format);
      expect(report.productCount).toBe(1);
    });
  }

  it("omits image columns in upload-after-import mode", () => {
    const { csv, rows } = buildProductCsv(listing, images, {
      format: "current",
      withImages: false,
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => !r.imageSrc && !r.variantImage)).toBe(true);
    expect(validateProductCsv(csv).ok).toBe(true);
  });

  it("writes a default variant for products without options", () => {
    const single: ProductListing = {
      ...listing,
      options: [{ name: "Title", values: ["Default Title"] }],
      variants: [{ option1: "Default Title", sku: "LC-0", price: 20, grams: 0, inventoryQty: 0 }],
    };
    const { csv } = buildProductCsv(single, [], { format: "legacy", withImages: true });
    const data = parse(csv);
    expect(data[1]![data[0]!.indexOf("Option1 Name")]).toBe("Title");
    expect(data[1]![data[0]!.indexOf("Option1 Value")]).toBe("Default Title");
    expect(validateProductCsv(csv).ok).toBe(true);
  });
});

describe("CSV validator", () => {
  const good = buildProductCsv(listing, images, { format: "legacy", withImages: true }).csv;
  const edit = (fn: (rows: string[][]) => void) => {
    const rows = parse(good);
    fn(rows);
    return Papa.unparse(rows, { newline: "\n" });
  };
  const failing = (csv: string) =>
    validateProductCsv(csv)
      .checks.filter((c) => !c.passed)
      .map((c) => c.name);

  it("rejects wrong headers and a BOM", () => {
    expect(failing(good.replace("Variant Price", "Price"))).toContain("headers");
    expect(failing(`﻿${good}`)).toContain("encoding");
  });

  it("catches duplicate SKUs, bad prices and misaligned options", () => {
    const h = parse(good)[0]!;
    const i = (name: string) => h.indexOf(name);
    expect(failing(edit((r) => (r[2]![i("Variant SKU")] = "LC-1")))).toContain("skus");
    expect(failing(edit((r) => (r[1]![i("Variant Price")] = "$34")))).toContain("prices");
    expect(failing(edit((r) => (r[2]![i("Variant Compare At Price")] = "30.00")))).toContain(
      "prices",
    );
    expect(failing(edit((r) => (r[3]![i("Option2 Value")] = "")))).toContain("options");
    expect(failing(edit((r) => (r[2]![i("Option3 Value")] = "XL")))).toContain("options");
    expect(failing(edit((r) => (r[3]![i("Option1 Value")] = "Sand")))).toContain("options"); // duplicate combo
    expect(failing(edit((r) => (r[1]![i("Variant Requires Shipping")] = "yes")))).toContain(
      "values",
    );
  });

  it("catches handle and image problems", () => {
    const h = parse(good)[0]!;
    const i = (name: string) => h.indexOf(name);
    expect(failing(edit((r) => (r[2]![i("Handle")] = "Bad Handle")))).toContain("handles");
    expect(failing(edit((r) => (r[6]![i("Image Position")] = "5")))).toContain("images");
    expect(failing(edit((r) => (r[5]![i("Image Src")] = "products/images/x.webp")))).toContain(
      "images",
    );
    expect(failing(edit((r) => (r[1]![i("Body (HTML)")] = "<script>x</script>")))).toContain(
      "html",
    );
  });
});

describe("Dawn theme files", () => {
  it("builds theme JSON that matches Dawn's schemas, and rejects bad values", async () => {
    const p = await dripperProject("Theme");
    await runContent(ctxFor(p.id));
    const project = await getProject(p.id);
    const theme = buildDawnTheme({
      brand: project.brandKit!,
      content: project.content!,
      listing: project.listing,
    });
    const text = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, JSON.stringify(v)]));
    expect(validateDawnTheme(text)).toEqual({ ok: true, issues: [] });

    const index = theme["templates/index.json"];
    expect(index.order).toEqual([
      "hero",
      "featured_product",
      "benefits",
      "faq",
      "trust_badges",
      "newsletter",
    ]);
    expect(index.sections.featured_product!.settings.product).toBe(project.listing!.handle);
    expect(Object.keys(index.sections.faq!.blocks!)).toHaveLength(10);
    // No fabricated social proof anywhere in the theme.
    expect(JSON.stringify(theme)).not.toMatch(/review/i);
    const current = theme["config/settings_data.json"].current;
    expect(current.type_header_font).toBe("lora_n4");
    const schemes = current.color_schemes as Record<string, { settings: Record<string, string> }>;
    expect(schemes["scheme-1"]!.settings.background).toBe(project.brandKit!.palette!.background);

    const broken = structuredClone(index);
    broken.sections.hero!.settings.image_height = "huge";
    broken.sections.faq!.settings.padding_top = 37;
    broken.sections.newsletter!.blocks!.paragraph!.settings.text = "no block tag";
    broken.sections.benefits!.type = "made-up";
    const res = validateDawnTheme({
      "templates/index.json": JSON.stringify(broken),
      "config/settings_data.json": "{",
    });
    expect(res.ok).toBe(false);
    const all = res.issues.join("\n");
    expect(all).toMatch(/image_height/);
    expect(all).toMatch(/padding_top/);
    expect(all).toMatch(/rich text/);
    expect(all).toMatch(/made-up/);
    expect(all).toMatch(/invalid JSON/);
  });
});

describe("export bundle", () => {
  const SECTION_8 = [
    "README-IMPORT-STEPS.md",
    "products/products.csv",
    "products/product.json",
    "products/description.html",
    "collections/collections.json",
    "navigation/menus.json",
    "theme/templates/index.json",
    "theme/config/settings_data.json",
    "theme/assets/logo.svg",
    "brand/brand-kit.json",
    "brand/brand-guide.md",
    "legal/placeholders-to-fill.md",
    "validation-report.json",
  ];

  it("contains every Section 8 file, a CSV that re-validates and valid theme JSON", async () => {
    const p = await dripperProject("Bundle");
    await runListing(ctxFor(p.id));
    await runContent(ctxFor(p.id));
    const res = await runExportBundle(
      ctxFor(p.id, { imageMode: "upload_after", csvFormat: "current" }),
    );
    const row = await prisma.exportRecord.findUniqueOrThrow({ where: { id: res.exportId } });
    const zip = new AdmZip(fromDataRelative(row.artifactPath!));
    const names = zip.getEntries().map((e) => e.entryName);
    for (const f of SECTION_8) expect(names).toContain(f);
    const handle = (await getProject(p.id)).listing!.handle;
    for (const h of [
      "about-us",
      "contact",
      "faq",
      "shipping-policy",
      "refund-policy",
      "privacy-policy",
      "terms-of-service",
    ])
      expect(names).toContain(`pages/${h}.html`);
    expect(names.filter((n) => n.startsWith("products/images/")).sort()).toEqual(
      [1, 2, 3].map((n) => `products/images/${handle}-${n}.webp`),
    );
    expect(names).toContain("products/image-mapping.csv");
    expect(res.fileName).toMatch(/^[a-z0-9-]+-shopify-export-\d{4}-\d{2}-\d{2}\.zip$/);

    const csv = zip.readAsText("products/products.csv");
    const check = validateProductCsv(csv, "current");
    expect(check.ok).toBe(true);
    expect(parse(csv)[0]).toEqual([...SHOPIFY_CSV_HEADERS_CURRENT]);

    const themeFiles = Object.fromEntries(
      names
        .filter((n) => n.startsWith("theme/") && n.endsWith(".json"))
        .map((n) => [n.slice(6), zip.readAsText(n)]),
    );
    expect(validateDawnTheme(themeFiles).ok).toBe(true);
    const report = JSON.parse(zip.readAsText("validation-report.json"));
    expect(report.ok).toBe(true);
    expect(report.theme.ok).toBe(true);
    expect(zip.readAsText("README-IMPORT-STEPS.md")).toMatch(/Media/);
    expect(zip.readAsText("legal/placeholders-to-fill.md")).toMatch(/\[SUPPORT EMAIL\]/);
    expect((await getProject(p.id)).status).toBe("exported");
  });

  it("public-URL mode links images through an expiring, token-protected route", async () => {
    const { GET } = await import("@/app/api/public/[exportId]/[file]/route");
    const download = await import("@/app/api/exports/[id]/download/route");
    const p = await dripperProject("Public");
    await runContent(ctxFor(p.id));
    const res = await runExportBundle(
      ctxFor(p.id, { imageMode: "public_url", csvFormat: "legacy" }),
    );
    const row = await prisma.exportRecord.findUniqueOrThrow({ where: { id: res.exportId } });
    const zip = new AdmZip(fromDataRelative(row.artifactPath!));
    const data = parse(zip.readAsText("products/products.csv"));
    const src = data[1]![data[0]!.indexOf("Image Src")]!;
    expect(src).toMatch(new RegExp(`/api/public/${res.exportId}/[a-z0-9-]+-1\\.webp\\?token=`));
    const report = JSON.parse(zip.readAsText("validation-report.json"));
    expect(report.issues.some((i: { message: string }) => /can't reach/.test(i.message))).toBe(
      true,
    );
    expect(zip.readAsText("README-IMPORT-STEPS.md")).toMatch(/localhost/);

    const url = new URL(src);
    const file = url.pathname.split("/").pop()!;
    const call = (token: string) =>
      GET(new Request(`http://localhost/api/public/${res.exportId}/${file}?token=${token}`), {
        params: Promise.resolve({ exportId: res.exportId, file }),
      });
    const ok = await call(url.searchParams.get("token")!);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect((await call("wrong")).status).toBe(404);
    const traversal = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ exportId: res.exportId, file: "..%2F..%2Fsecret" }),
    });
    expect(traversal.status).toBe(404);
    await prisma.exportRecord.update({
      where: { id: res.exportId },
      data: { publicExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(url.searchParams.get("token")!)).status).toBe(410);

    const dl = await download.GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: res.exportId }),
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/attachment; filename=".*\.zip"/);
  });
});
