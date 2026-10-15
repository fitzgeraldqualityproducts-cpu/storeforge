import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ZipArchive } from "archiver";
import { env } from "@/lib/config";
import { orderedActiveAssets } from "@/lib/db/assets";
import { prisma } from "@/lib/db/client";
import { hydrateExport } from "@/lib/db/exports";
import { getProject, updateProject, type ProjectRecord } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import type { JobContext } from "@/lib/jobs/runner";
import { toHandle } from "@/lib/listing/text";
import { runImages } from "@/lib/pipeline/images";
import { visionFor } from "@/lib/pipeline/run";
import { BundleOptions, ValidationReport, type ImageAsset } from "@/lib/schemas";
import { fromDataRelative, projectDir, toDataRelative } from "@/lib/security/paths";
import { buildProductCsv, imageMappingCsv, type CsvImage } from "./csv";
import { validateProductCsv } from "./csv-validate";
import { brandGuide, importReadme, placeholdersDoc } from "./docs";
import { buildDawnTheme, validateDawnTheme } from "./theme";

/** Public image links for "Public URL mode" stay valid this long. */
export const PUBLIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** `<handle>-<position>.webp`, the export naming from the spec (Section 7). */
export function exportImageName(handle: string, position: number) {
  return `${handle}-${position}.webp`;
}

const isLocalUrl = (u: string) => /^(https?:\/\/)(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u);

export function requireReady(project: ProjectRecord) {
  if (!project.listing) throw new UserFacingError("Write the product listing before exporting.");
  if (!project.content) throw new UserFacingError("Write the store content before exporting.");
  if (!project.brandKit?.selectedName)
    throw new UserFacingError("Create the brand kit before exporting.");
  return { listing: project.listing, content: project.content, brand: project.brandKit };
}

/** Make sure every active image has a processed file (runs the image step if needed). */
export async function processedAssets(
  ctx: JobContext,
  at: (f: number) => number,
): Promise<ImageAsset[]> {
  let assets = await orderedActiveAssets(ctx.projectId);
  if (assets.some((a) => !a.processedPath)) {
    await runImages(ctx, { vision: visionFor(ctx.projectId), range: [at(0.05), at(0.35)] });
    assets = await orderedActiveAssets(ctx.projectId);
  }
  return assets.filter((a) => a.processedPath);
}

function zipTo(file: string, entries: { name: string; data?: string | Buffer; path?: string }[]) {
  return new Promise<void>((resolve, reject) => {
    const out = createWriteStream(file);
    const zip = new ZipArchive({ zlib: { level: 9 } });
    out.on("close", () => resolve());
    out.on("error", reject);
    zip.on("error", reject);
    zip.on("warning", reject);
    zip.pipe(out);
    for (const e of entries) {
      if (e.path) zip.file(e.path, { name: e.name });
      else zip.append(e.data ?? "", { name: e.name });
    }
    void zip.finalize();
  });
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Build the export ZIP (spec Section 8), validate it, and record it. */
export async function runExportBundle(ctx: JobContext, rawOptions: unknown = ctx.payload) {
  const options = BundleOptions.parse(rawOptions ?? {});
  const at = (f: number) => f * 100;
  let project = await getProject(ctx.projectId);
  requireReady(project);
  await ctx.progress("export", at(0.02), "Preparing images");
  const assets = await processedAssets(ctx, at);
  project = await getProject(ctx.projectId);
  const { listing, content, brand } = requireReady(project);

  const exportId = randomUUID();
  const dir = projectDir(ctx.projectId, "exports", exportId);
  const imagesDir = path.join(dir, "images");
  await mkdir(imagesDir, { recursive: true });

  // Public URL mode: our own expiring, token-protected route, unless the merchant hosts the
  // images at PUBLIC_IMAGE_BASE_URL themselves.
  const e = env();
  const publicMode = options.imageMode === "public_url";
  const selfHosted = publicMode && !e.PUBLIC_IMAGE_BASE_URL;
  const token = selfHosted ? randomBytes(24).toString("base64url") : null;
  const expiresAt = selfHosted ? new Date(Date.now() + PUBLIC_LINK_TTL_MS) : null;
  const appBase = e.APP_BASE_URL.replace(/\/+$/, "");
  const baseUrl = publicMode
    ? (e.PUBLIC_IMAGE_BASE_URL?.replace(/\/+$/, "") ?? `${appBase}/api/public/${exportId}`)
    : "";

  await ctx.progress(
    "export",
    at(0.4),
    `Copying ${assets.length} image${assets.length === 1 ? "" : "s"}`,
  );
  const images: (CsvImage & { file: string })[] = [];
  for (const [i, a] of assets.entries()) {
    const fileName = exportImageName(listing.handle, i + 1);
    const file = path.join(imagesDir, fileName);
    await copyFile(fromDataRelative(a.processedPath!), file);
    images.push({
      assetId: a.id,
      fileName,
      file,
      alt: a.altText,
      variantKey: a.variantKey,
      url: publicMode ? `${baseUrl}/${fileName}${token ? `?token=${token}` : ""}` : null,
    });
  }

  await ctx.progress("export", at(0.55), "Writing the product CSV");
  const { csv } = buildProductCsv(listing, images, {
    format: options.csvFormat,
    withImages: publicMode,
  });
  const csvCheck = validateProductCsv(csv, options.csvFormat);

  await ctx.progress("export", at(0.65), "Building Dawn theme files");
  const theme = buildDawnTheme({ brand, content, listing });
  const themeText = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, json(v)]));
  const themeCheck = validateDawnTheme(themeText);

  const issues = [...csvCheck.issues];
  if (publicMode && isLocalUrl(baseUrl))
    issues.push({
      level: "warning",
      check: "images",
      message: `Image links point to ${baseUrl}, which Shopify can't reach. Deploy the app or use a tunnel, or choose "Upload images after import".`,
      row: null,
    });
  if (!assets.length)
    issues.push({
      level: "warning",
      check: "images",
      message: "The product has no images.",
      row: null,
    });
  const report = ValidationReport.parse({
    ok: csvCheck.ok && themeCheck.ok,
    checkedAt: new Date().toISOString(),
    csvFormat: options.csvFormat,
    rowCount: csvCheck.rowCount,
    checks: [
      ...csvCheck.checks,
      {
        name: "theme",
        passed: themeCheck.ok,
        detail: themeCheck.ok
          ? "Theme JSON parses and matches Dawn's section schemas"
          : `${themeCheck.issues.length} problem(s)`,
      },
    ],
    issues,
    theme: themeCheck,
  });

  const storeName = content.settings.storeName || brand.selectedName || project.name;
  const readme = importReadme({
    storeName,
    listing,
    content,
    brand,
    imageMode: options.imageMode,
    csvFormat: options.csvFormat,
    imageCount: images.length,
    publicImages: publicMode
      ? {
          baseUrl,
          expiresAt: expiresAt ? expiresAt.toISOString().replace("T", " ").slice(0, 16) : null,
          isLocal: isLocalUrl(baseUrl),
        }
      : null,
    hasLogo: Boolean(brand.logoSvg),
  });

  const entries: { name: string; data?: string | Buffer; path?: string }[] = [
    { name: "README-IMPORT-STEPS.md", data: readme },
    { name: "products/products.csv", data: csv },
    { name: "products/image-mapping.csv", data: imageMappingCsv(listing, images) },
    ...images.map((img) => ({ name: `products/images/${img.fileName}`, path: img.file })),
    {
      name: "products/product.json",
      data: json({ listing, images: images.map(({ file: _file, ...rest }) => rest) }),
    },
    { name: "products/description.html", data: `${listing.descriptionHtml}\n` },
    ...content.pages.map((p) => ({ name: `pages/${p.handle}.html`, data: `${p.bodyHtml}\n` })),
    {
      name: "collections/collections.json",
      data: json(
        content.collections.map((c) => ({
          ...c,
          note:
            c.handle === "all"
              ? "Shopify provides /collections/all automatically; create this only if you want a custom page."
              : undefined,
        })),
      ),
    },
    {
      name: "navigation/menus.json",
      data: json([
        { handle: "main-menu", title: "Main menu", items: content.menus.main },
        { handle: "footer", title: "Footer menu", items: content.menus.footer },
      ]),
    },
    ...Object.entries(themeText).map(([name, data]) => ({ name: `theme/${name}`, data })),
    { name: "brand/brand-kit.json", data: json(brand) },
    { name: "brand/brand-guide.md", data: brandGuide(brand, storeName) },
    { name: "legal/placeholders-to-fill.md", data: placeholdersDoc(content, listing) },
    { name: "validation-report.json", data: json(report) },
  ];
  if (brand.logoSvg) entries.push({ name: "theme/assets/logo.svg", data: brand.logoSvg });
  if (brand.logoPngPath) {
    const png = fromDataRelative(brand.logoPngPath);
    if (await stat(png).catch(() => null))
      entries.push({ name: "theme/assets/logo.png", path: png });
  }

  await ctx.progress("export", at(0.8), "Zipping the bundle");
  const date = new Date().toISOString().slice(0, 10);
  const zipName = `${toHandle(storeName, 40)}-shopify-export-${date}.zip`;
  const zipPath = path.join(dir, zipName);
  await zipTo(zipPath, entries);

  const row = await prisma.exportRecord.create({
    data: {
      id: exportId,
      projectId: ctx.projectId,
      type: "bundle",
      artifactPath: toDataRelative(zipPath),
      validationReport: JSON.stringify(report),
      options: JSON.stringify(options),
      publicToken: token,
      publicExpiresAt: expiresAt,
    },
  });
  await updateProject(ctx.projectId, {
    status: "exported",
    steps: { export: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  await ctx.progress(
    "export",
    at(1),
    report.ok ? "Bundle ready" : "Bundle ready with problems to fix",
  );
  const view = hydrateExport(row);
  return {
    exportId,
    fileName: view.fileName,
    ok: report.ok,
    errors: report.issues.filter((i) => i.level === "error").length,
    warnings: report.issues.filter((i) => i.level === "warning").length,
    bytes: (await stat(zipPath)).size,
  };
}
