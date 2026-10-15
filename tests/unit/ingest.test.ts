import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { ingestImage } from "@/lib/images/ingest";
import { detectImageType } from "@/lib/images/magic";
import { POST as upload } from "@/app/api/projects/[id]/upload/route";

const png = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: "#c05030" } })
    .png()
    .toBuffer();

describe("magic byte detection", () => {
  it("detects real formats and rejects lies", async () => {
    expect(detectImageType(await png())).toBe("image/png");
    expect(
      detectImageType(
        await sharp(await png())
          .jpeg()
          .toBuffer(),
      ),
    ).toBe("image/jpeg");
    expect(
      detectImageType(
        await sharp(await png())
          .webp()
          .toBuffer(),
      ),
    ).toBe("image/webp");
    expect(
      detectImageType(readFileSync(path.join(__dirname, "../fixtures/images/sample.heic"))),
    ).toBe("image/heic");
    expect(detectImageType(Buffer.from("<html><body>not an image</body></html>"))).toBeNull();
  });
});

describe("image ingest", () => {
  it("stores a valid upload with dimensions and position", async () => {
    const p = await createProject("Ingest");
    const a = await ingestImage(p.id, await png(), { origin: "upload", fileName: "a.png" });
    expect(a.width).toBe(640);
    expect(a.height).toBe(480);
    expect(a.position).toBe(0);
    expect(a.isHero).toBe(true);
    const b = await ingestImage(p.id, await png(), {
      origin: "scraped",
      sourceUrl: "https://x.test/a.png",
    });
    expect(b.position).toBe(1);
    expect(b.flags.map((f) => f.code)).toContain("third_party_source");
  });

  it("converts HEIC uploads to JPEG", async () => {
    const p = await createProject("Heic");
    const heic = readFileSync(path.join(__dirname, "../fixtures/images/sample.heic"));
    const a = await ingestImage(p.id, heic, { origin: "upload", fileName: "photo.heic" });
    expect(a.mimeType).toBe("image/jpeg");
    expect(a.originalPath.endsWith(".jpg")).toBe(true);
    expect(a.width).toBe(64);
  });

  it("rejects non-images even with an image extension", async () => {
    const p = await createProject("Bad");
    await expect(
      ingestImage(p.id, Buffer.from("GIF89a-not-really".padEnd(64, "x")), {
        origin: "upload",
        fileName: "x.jpg",
      }),
    ).rejects.toBeInstanceOf(UserFacingError);
    await expect(
      ingestImage(p.id, Buffer.from("#!/bin/sh\necho pwned\n".padEnd(64, " ")), {
        origin: "upload",
        fileName: "x.png",
      }),
    ).rejects.toThrow(/not a supported image/);
  });
});

describe("upload route", () => {
  it("accepts multipart images and reports per-file errors", async () => {
    const p = await createProject("Upload route");
    const form = new FormData();
    form.append(
      "files",
      new File([new Uint8Array(await png())], "good.png", { type: "image/png" }),
    );
    form.append(
      "files",
      new File([new TextEncoder().encode("nope".repeat(10))], "bad.jpg", { type: "image/jpeg" }),
    );
    const res = await upload(new Request("http://localhost/api", { method: "POST", body: form }), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assets: unknown[]; errors: { file: string }[] };
    expect(body.assets).toHaveLength(1);
    expect(body.errors[0]!.file).toBe("bad.jpg");
  });
});
