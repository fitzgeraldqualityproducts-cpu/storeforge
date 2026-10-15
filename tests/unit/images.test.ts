import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PATCH as patchImages } from "@/app/api/projects/[id]/images/route";
import { listAssets } from "@/lib/db/assets";
import { createProject, getProject } from "@/lib/db/projects";
import { dedupe } from "@/lib/images/dedupe";
import { perceptualHash, hammingDistance } from "@/lib/images/hash";
import { ingestImage } from "@/lib/images/ingest";
import { detectImageType } from "@/lib/images/magic";
import { processImage } from "@/lib/images/process";
import { scoreQuality } from "@/lib/images/quality";
import type { JobContext } from "@/lib/jobs/runner";
import { runImages } from "@/lib/pipeline/images";

const fixture = (n: number) =>
  readFileSync(path.join(__dirname, `../fixtures/site/images/dripper-${n}.jpg`));

const ctxFor = (projectId: string): JobContext => ({
  jobId: "t",
  projectId,
  type: "images",
  payload: {},
  progress: async () => undefined,
});

describe("perceptual hashing and dedupe", () => {
  it("treats resized/re-encoded copies as duplicates and different shots as distinct", async () => {
    const a = fixture(1);
    const smaller = await sharp(a).resize(600).jpeg({ quality: 60 }).toBuffer();
    const [ha, hs, hb, hc] = await Promise.all([
      perceptualHash(a),
      perceptualHash(smaller),
      perceptualHash(fixture(2)),
      perceptualHash(fixture(3)),
    ]);
    expect(hammingDistance(ha, hs)).toBeLessThanOrEqual(6);
    expect(hammingDistance(ha, hb)).toBeGreaterThan(6);
    expect(hammingDistance(ha, hc)).toBeGreaterThan(6);
  });

  it("keeps the highest-resolution member of each duplicate group", () => {
    const r = dedupe([
      { id: "small", phash: "ffff0000ffff0000", width: 600, height: 600, rank: 0 },
      { id: "big", phash: "ffff0000ffff0001", width: 1200, height: 1200, rank: 1 },
      { id: "other", phash: "0000ffff0000ffff", width: 800, height: 800, rank: 2 },
    ]);
    expect(r.keep.sort()).toEqual(["big", "other"]);
    expect(r.duplicates.get("small")).toBe("big");
  });
});

describe("quality scoring", () => {
  it("scores a sharp, well-exposed photo above a blurry, dark, tiny one", async () => {
    const good = await scoreQuality(fixture(1));
    const blurry = await scoreQuality(await sharp(fixture(1)).blur(12).toBuffer());
    const dark = await scoreQuality(await sharp(fixture(1)).linear(0.15, 0).toBuffer());
    const tiny = await scoreQuality(await sharp(fixture(1)).resize(320).toBuffer());
    expect(good.score).toBeGreaterThan(blurry.score);
    expect(blurry.flags.map((f) => f.code)).toContain("blurry");
    expect(dark.flags.map((f) => f.code)).toContain("under_exposed");
    expect(tiny.flags.map((f) => f.code)).toContain("low_resolution");
    expect(good.note).toMatch(/1200×1200px/);
  });

  it("penalises vision-detected watermarks", async () => {
    const plain = await scoreQuality(fixture(2));
    const marked = await scoreQuality(fixture(2), { watermark: true });
    expect(marked.score).toBeLessThan(plain.score);
    expect(marked.flags.map((f) => f.code)).toContain("watermark");
  });
});

describe("processing", () => {
  it("auto-rotates, fits within 2048px, squares, encodes WebP+JPEG and strips metadata", async () => {
    // 3000×1500 landscape stored with EXIF orientation 6 (rotate 90° CW) → displays as portrait.
    const raw = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: "#3a6ea5" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 800, height: 800, channels: 3, background: "#d9a441" },
          })
            .png()
            .toBuffer(),
          left: 200,
          top: 300,
        },
      ])
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Someone" } } })
      .toBuffer();
    const out = await processImage(raw, { squarePad: true, background: "#ffffff" });
    expect(out.width).toBe(out.height);
    expect(out.width).toBeLessThanOrEqual(2048);
    expect(detectImageType(out.webp)).toBe("image/webp");
    expect(detectImageType(out.jpeg)).toBe("image/jpeg");
    const meta = await sharp(out.webp).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    const jmeta = await sharp(out.jpeg).metadata();
    expect(jmeta.exif).toBeUndefined();

    const notSquare = await processImage(raw, { squarePad: false, background: "#ffffff" });
    // Orientation 6 means the displayed image is portrait.
    expect(notSquare.height).toBeGreaterThan(notSquare.width);
    expect(Math.max(notSquare.width, notSquare.height)).toBeLessThanOrEqual(2048);
  });

  it("pads with the brand background colour", async () => {
    const wide = await sharp({
      create: { width: 1600, height: 800, channels: 3, background: "#222222" },
    })
      .png()
      .toBuffer();
    const out = await processImage(wide, { squarePad: true, background: "#f4e9dc" });
    const { data } = await sharp(out.jpeg)
      .extract({ left: 2, top: 2, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0]! - 0xf4)).toBeLessThan(6);
    expect(Math.abs(data[1]! - 0xe9)).toBeLessThan(6);
  });
});

describe("image pipeline job", () => {
  it("dedupes, scores, discards weak images, processes and writes alt text", async () => {
    const p = await createProject("Images");
    await ingestImage(p.id, fixture(1), { origin: "upload", fileName: "1.jpg" });
    await ingestImage(p.id, fixture(2), { origin: "upload", fileName: "2.jpg" });
    await ingestImage(p.id, fixture(3), { origin: "upload", fileName: "3.jpg" });
    // A smaller re-encode of image 1 (duplicate) and a terrible photo (blurry + dark).
    await ingestImage(p.id, await sharp(fixture(1)).resize(700).jpeg({ quality: 50 }).toBuffer(), {
      origin: "scraped",
      sourceUrl: "https://x.test/dup.jpg",
    });
    await ingestImage(
      p.id,
      await sharp(fixture(3)).resize(400).blur(20).linear(0.2, 0).toBuffer(),
      { origin: "upload", fileName: "bad.jpg" },
    );

    const res = await runImages(ctxFor(p.id));
    expect(res.duplicates).toBe(1);
    expect(res.lowQuality).toBe(1);
    expect(res.kept).toBe(3);

    const all = await listAssets(p.id, { includeDiscarded: true });
    const active = all.filter((a) => !a.discarded);
    expect(active.every((a) => a.processedPath?.endsWith(".webp"))).toBe(true);
    expect(active.every((a) => a.altText.length > 0 && a.altText.length <= 125)).toBe(true);
    expect(active.filter((a) => a.isHero)).toHaveLength(1);
    expect(all.find((a) => a.discardReason?.startsWith("Duplicate"))?.origin).toBe("scraped");
    expect(all.find((a) => a.discardReason?.startsWith("Low quality"))).toBeTruthy();
    expect((await getProject(p.id)).steps.images.status).toBe("ready");
  });

  it("uses vision results for alt text and role ordering", async () => {
    const p = await createProject("Vision");
    const a1 = await ingestImage(p.id, fixture(3), { origin: "upload" });
    const a2 = await ingestImage(p.id, fixture(1), { origin: "upload" });
    await runImages(ctxFor(p.id), {
      vision: async (assets) =>
        assets.map((a) => ({
          imageId: a.id,
          altText:
            a.id === a2.id ? "Sand stoneware dripper, front view" : "Close-up of the glaze texture",
          role: a.id === a2.id ? ("hero" as const) : ("detail" as const),
          hasWatermark: false,
          hasTextOverlay: false,
          isProductVisible: true,
          qualityIssues: [],
        })),
    });
    const active = (await listAssets(p.id)).sort((x, y) => x.position - y.position);
    expect(active.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(active[0]!.altText).toBe("Sand stoneware dripper, front view");
    expect(active[1]!.role).toBe("detail");
  });
});

describe("gallery edits", () => {
  it("reorders, sets hero, discards and restores", async () => {
    const p = await createProject("Gallery");
    const ids = [];
    for (const n of [1, 2, 3])
      ids.push((await ingestImage(p.id, fixture(n), { origin: "upload" })).id);
    const call = (body: unknown) =>
      patchImages(
        new Request(`http://localhost/api/projects/${p.id}/images`, {
          method: "PATCH",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: p.id }) },
      );
    let res = await call({ order: [ids[2], ids[0], ids[1]] });
    expect(res.status).toBe(200);
    let active = (await listAssets(p.id)).sort((a, b) => a.position - b.position);
    expect(active.map((a) => a.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(active[0]!.isHero).toBe(true);

    res = await call({
      heroId: ids[1],
      updates: [
        { id: ids[0], discarded: true },
        { id: ids[2], altText: "  Glaze detail ", variantKey: "Color:Sand" },
      ],
    });
    expect(res.status).toBe(200);
    active = (await listAssets(p.id)).sort((a, b) => a.position - b.position);
    expect(active.map((a) => a.id)).toEqual([ids[1], ids[2]]);
    expect(active[1]!.altText).toBe("Glaze detail");
    expect(active[1]!.variantKey).toBe("Color:Sand");

    res = await call({
      updates: [{ id: ids[0], discarded: false }],
      options: { background: "white", squarePad: false },
    });
    expect(await listAssets(p.id)).toHaveLength(3);
    expect((await getProject(p.id)).imageOptions.squarePad).toBe(false);

    expect((await call({ heroId: "nope" })).status).toBe(404);
    expect((await call({ updates: [{ id: ids[0], altText: "x".repeat(200) }] })).status).toBe(400);
  });
});
