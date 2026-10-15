import { readFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { validateProductCsv } from "@/lib/export/csv-validate";
import { validateDawnTheme } from "@/lib/export/theme";

/**
 * Fixture product → store → ZIP, through the real UI in fixture AI mode (no API keys needed).
 * Covers spec acceptance: URL pipeline with no manual steps, photos-only store with
 * [CONFIRM] markers, a ZIP with every Section 8 file whose CSV re-validates, and the UI at
 * 375/768/1440 px plus keyboard use.
 */

const FIXTURE_URL = "http://127.0.0.1:4555/product.html";
const PHOTOS = [1, 2, 3].map((n) =>
  path.join(__dirname, "..", "fixtures", "site", "images", `dripper-${n}.jpg`),
);
const SECTION_8 = [
  "README-IMPORT-STEPS.md",
  "products/products.csv",
  "products/product.json",
  "products/description.html",
  "products/image-mapping.csv",
  "collections/collections.json",
  "navigation/menus.json",
  "theme/templates/index.json",
  "theme/config/settings_data.json",
  "theme/sections/header-group.json",
  "theme/sections/footer-group.json",
  "theme/assets/logo.svg",
  "brand/brand-kit.json",
  "brand/brand-guide.md",
  "legal/placeholders-to-fill.md",
  "validation-report.json",
  ...[
    "about-us",
    "contact",
    "faq",
    "shipping-policy",
    "refund-policy",
    "privacy-policy",
    "terms-of-service",
  ].map((h) => `pages/${h}.html`),
];

interface ProjectJson {
  project: {
    id: string;
    listing: {
      handle: string;
      descriptionHtml: string;
      variants: Record<string, unknown>[];
    } | null;
    content: { pages: unknown[] } | null;
  };
  jobs: { type: string; status: string; error: string | null }[];
  assets: { discarded: boolean }[];
  preflight: { items: { id: string; status: string; detail: string }[] };
}

async function createProject(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url().match(/projects\/([0-9a-f-]{36})/)![1]!;
}

async function project(request: APIRequestContext, id: string): Promise<ProjectJson> {
  const res = await request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as ProjectJson;
}

async function waitForJob(request: APIRequestContext, id: string, type: string) {
  await expect
    .poll(
      async () => {
        const job = (await project(request, id)).jobs.find((j) => j.type === type);
        if (job?.status === "failed") throw new Error(`${type} failed: ${job.error}`);
        return job?.status;
      },
      { timeout: 200_000, intervals: [1000] },
    )
    .toBe("succeeded");
}

function checkZip(buf: Buffer, handle: string, format: "current" | "legacy" = "current") {
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((e) => e.entryName);
  for (const f of SECTION_8) expect(names, f).toContain(f);
  for (const n of [1, 2, 3]) expect(names).toContain(`products/images/${handle}-${n}.webp`);
  const csv = zip.readAsText("products/products.csv");
  const check = validateProductCsv(csv, format);
  expect(check.issues.filter((i) => i.level === "error")).toEqual([]);
  expect(check.ok).toBe(true);
  const theme = Object.fromEntries(
    names
      .filter((n) => n.startsWith("theme/") && n.endsWith(".json"))
      .map((n) => [n.slice("theme/".length), zip.readAsText(n)]),
  );
  expect(validateDawnTheme(theme)).toEqual({ ok: true, issues: [] });
  const report = JSON.parse(zip.readAsText("validation-report.json")) as { ok: boolean };
  expect(report.ok).toBe(true);
}

test.describe.serial("fixture product to Shopify bundle", () => {
  let urlProjectId = "";

  test("URL only: generates the whole store and a valid ZIP with no manual steps", async ({
    page,
    request,
  }) => {
    urlProjectId = await createProject(page, "E2E dripper (URL)");
    await page.getByLabel("Primary product URL").fill(FIXTURE_URL);
    await page.getByText("I have the right to use these images").click();
    await page.getByRole("button", { name: "Save & generate my store" }).click();
    await waitForJob(request, urlProjectId, "pipeline");

    const view = await project(request, urlProjectId);
    expect(view.project.listing).not.toBeNull();
    expect(view.project.content?.pages).toHaveLength(7);
    expect(view.assets.filter((a) => !a.discarded).length).toBeGreaterThanOrEqual(3);

    await page.goto(`/projects/${urlProjectId}?step=export`);
    await expect(page.getByRole("heading", { name: "Pre-flight checklist" })).toBeVisible();
    await expect(
      page.getByText("doesn't verify supplier reliability, product safety, or regulatory"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Build bundle" }).click();
    const download = page.getByRole("link", { name: "Download" }).first();
    await expect(download).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/is ready to import/)).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    const buf = readFileSync((await file.path())!);
    checkZip(buf, view.project.listing!.handle);
  });

  test("3 photos and no URL: a complete store with [CONFIRM] markers", async ({
    page,
    request,
  }) => {
    const id = await createProject(page, "E2E dripper (photos)");
    await page.locator('input[type="file"]').setInputFiles(PHOTOS);
    await expect(page.getByRole("button", { name: "Remove image 3" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByText("I have the right to use these images").click();
    await page.getByRole("button", { name: "Save & generate my store" }).click();
    await waitForJob(request, id, "pipeline");

    const view = await project(request, id);
    const listing = view.project.listing!;
    expect(listing.descriptionHtml).toContain("[CONFIRM:");
    expect(view.project.content?.pages).toHaveLength(7);

    // With no cost or market price StoreForge doesn't invent one: the pre-flight asks for it.
    const required = view.preflight.items.find((i) => i.id === "required")!;
    expect(required.status).toBe("fail");
    expect(required.detail).toContain("price");
    const priced = await request.patch(`/api/projects/${id}`, {
      data: {
        listing: { ...listing, variants: listing.variants.map((v) => ({ ...v, price: 24 })) },
      },
    });
    expect(priced.ok()).toBe(true);

    const res = await request.post(`/api/projects/${id}/export/bundle`, {
      data: { imageMode: "upload_after", csvFormat: "legacy" },
    });
    expect(res.status()).toBe(202);
    await waitForJob(request, id, "export_bundle");
    const exportId = (
      (await (await request.get(`/api/projects/${id}`)).json()) as {
        exports: { id: string; type: string }[];
      }
    ).exports.find((e) => e.type === "bundle")!.id;
    const zip = await request.get(`/api/exports/${exportId}/download`);
    expect(zip.ok()).toBe(true);
    const buf = Buffer.from(await zip.body());
    expect(new AdmZip(buf).readAsText("products/products.csv")).toMatch(
      /^Handle,Title,Body \(HTML\)/,
    );
    checkZip(buf, listing.handle, "legacy");
  });

  test("every step fits 375, 768 and 1440 px without sideways scrolling", async ({ page }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const step of ["input", "analysis", "brand", "listing", "images", "content", "export"]) {
        await page.goto(`/projects/${urlProjectId}?step=${step}`);
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.waitForTimeout(300);
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scroll, `${step} at ${width}px`).toBeLessThanOrEqual(width);
      }
    }
  });

  test("works from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // Tab reaches the project name field and Enter creates the project.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      if (await page.getByLabel("Project name").evaluate((el) => el === document.activeElement))
        break;
    }
    await expect(page.getByLabel("Project name")).toBeFocused();
    await page.keyboard.type("Keyboard store");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/projects\//);

    // The stepper is reachable with Tab and moves between steps with Enter.
    await page.goto(`/projects/${urlProjectId}?step=input`);
    await expect(page.locator("main h1").first()).toBeVisible();
    const exportStep = page.getByRole("button", { name: /Export/ }).first();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await exportStep.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(exportStep).toBeFocused();
    const outline = await exportStep.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.boxShadow}`;
    });
    expect(outline).not.toBe("none none");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/step=export/);
    await expect(page.getByRole("heading", { name: "Pre-flight checklist" })).toBeVisible();
  });
});
