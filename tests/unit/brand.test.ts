import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AA_NORMAL,
  adjustForContrast,
  checkPalette,
  contrastRatio,
  enforcePalette,
  palettePassesAA,
} from "@/lib/brand/contrast";
import { findLibraryFont, resolveFont, themeHandle } from "@/lib/brand/fonts";
import { renderLogo, type FontLoader } from "@/lib/brand/logo";
import {
  availabilityLookupUrl,
  checkName,
  finalizeCandidate,
  nameIsUsable,
  normalizeDomain,
} from "@/lib/brand/names";
import { resetEnvCache } from "@/lib/config";
import { createProject, getProject, updateProject } from "@/lib/db/projects";
import { ingestImage } from "@/lib/images/ingest";
import type { JobContext } from "@/lib/jobs/runner";
import { runBrand, runBrandDetails } from "@/lib/pipeline/brand";
import { parseProductHtml } from "@/lib/scrape/parse";
import { fromDataRelative } from "@/lib/security/paths";
import { SourceExtraction, type Palette } from "@/lib/schemas";

const fake = vi.hoisted(() => ({
  queue: [] as unknown[],
  requests: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/ai/client", () => ({
  anthropic: () => ({
    messages: {
      stream: (req: Record<string, unknown>) => {
        fake.requests.push(structuredClone(req));
        return {
          finalMessage: async () => {
            const next = fake.queue.shift();
            if (!next) throw new Error("no scripted response");
            return next;
          },
        };
      },
    },
  }),
}));

import { generateBrandDetails, generateBrandNames } from "@/lib/ai/brand";

const SYSTEM_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const systemFont: FontLoader = async () => {
  const b = readFileSync(SYSTEM_FONT);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const noFont: FontLoader = async () => null;

const ctxFor = (projectId: string): JobContext => ({
  jobId: "t",
  projectId,
  type: "brand_details",
  payload: {},
  progress: async () => undefined,
});

const badPalette: Palette = {
  primary: "#9FC5E8",
  secondary: "#CCCCCC",
  accent: "#FFE599",
  background: "#FFFFFF",
  text: "#AAAAAA",
  surface: "#F3F3F3",
};

describe("contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("adjusts a colour until it passes, keeping its hue", () => {
    const fixed = adjustForContrast("#9FC5E8", "#FFFFFF");
    expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(AA_NORMAL);
    const [r, , b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(b!).toBeGreaterThan(r!); // still blue
    expect(
      contrastRatio(adjustForContrast("#333333", "#111111"), "#111111"),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("enforces every required pair in code and reports the changes", () => {
    expect(palettePassesAA(badPalette)).toBe(false);
    const { palette, changes } = enforcePalette(badPalette);
    expect(palettePassesAA(palette)).toBe(true);
    expect(
      checkPalette(palette)
        .filter((c) => c.required)
        .every((c) => c.pass),
    ).toBe(true);
    expect(changes.some((c) => c.startsWith("text"))).toBe(true);
    expect(changes.some((c) => c.startsWith("primary"))).toBe(true);
    expect(palette.background).toBe("#FFFFFF"); // background is never changed
    const good = enforcePalette(palette);
    expect(good.changes).toEqual([]);
  });
});

describe("name checks", () => {
  it("flags length, symbols, pronounceability and brand collisions", () => {
    expect(checkName("Hearth Drip")).toMatchObject({
      length: 11,
      pronounceable: true,
      hasDigitsOrSymbols: false,
      notes: [],
    });
    expect(checkName("Brew2Go").hasDigitsOrSymbols).toBe(true);
    expect(checkName("Xkcdtrvw").pronounceable).toBe(false);
    expect(checkName("Wonderfulmornings").notes.join()).toMatch(/17 characters/);
    expect(nameIsUsable(checkName("Nike Pour"))).toBe(false);
    const kiln = checkName("Kilnworks", { avoid: ["Kilnworks Supply Co."] });
    expect(kiln.notes.join()).toMatch(/Too close/);
    expect(nameIsUsable(kiln)).toBe(false);
  });

  it("normalizes domain suggestions and never claims availability", () => {
    expect(normalizeDomain("Hearth Drip")).toBe("hearthdrip.com");
    expect(normalizeDomain("Hearth Drip", "https://www.Hearth-Drip.shop/")).toBe(
      "hearth-drip.shop",
    );
    expect(normalizeDomain("Café Ö", "not a domain")).toBe("cafeo.com");
    expect(availabilityLookupUrl("hearthdrip.com")).toBe(
      "https://lookup.icann.org/en/lookup?name=hearthdrip.com",
    );
    const c = finalizeCandidate({ name: "  Hearth   Drip ", rationale: "x" });
    expect(c.name).toBe("Hearth Drip");
    expect(c.domainSuggestion).toBe("hearthdrip.com");
  });
});

describe("fonts", () => {
  it("maps families to verified Shopify library handles", () => {
    expect(resolveFont("playfair display")).toMatchObject({
      family: "Playfair Display",
      shopifyHandle: "playfair_display_n4",
      inShopifyLibrary: true,
    });
    expect(resolveFont("EB Garamond").shopifyHandle).toBe("ebgaramond_n4");
    expect(findLibraryFont("Source Serif 4")?.handle).toBe("source_serif_4_n4");
  });

  it("marks unknown families as requiring a theme upload with a library fallback", () => {
    const c = resolveFont("Cormorant Garamond");
    expect(c.inShopifyLibrary).toBe(false);
    expect(c.shopifyHandle).toBeNull();
    expect(c.note).toMatch(/requires a theme upload/);
    expect(themeHandle(c)).toBe("lora_n4");
    expect(themeHandle(resolveFont("Some Display"))).toBe("playfair_display_n4");
  });
});

describe("logo", () => {
  const kit = (name: string) => ({
    selectedName: name,
    palette: enforcePalette(badPalette).palette,
    fonts: { heading: resolveFont("Inter"), body: resolveFont("Inter") },
  });

  it.runIf(existsSync(SYSTEM_FONT))("outlines the wordmark and renders a 1200px PNG", async () => {
    const p = await createProject("Logo");
    const logo = (await renderLogo(p.id, kit("Hearth Drip"), { loadFont: systemFont }))!;
    expect(logo.logoOutlined).toBe(true);
    expect(logo.logoSvg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/,
    );
    expect(logo.logoSvg).toContain("<path fill=");
    expect(logo.logoSvg).not.toContain("<text");
    expect(logo.logoSvg).toContain('<title id="logo-title">Hearth Drip</title>');
    const meta = await sharp(fromDataRelative(logo.logoPngPath)).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1200);
    expect(meta.hasAlpha).toBe(true);
  });

  it("falls back to escaped live text when the font can't be loaded", async () => {
    const p = await createProject("Logo fallback");
    const logo = (await renderLogo(p.id, kit(`Fern <script>`), { loadFont: noFont }))!;
    expect(logo.logoOutlined).toBe(false);
    expect(logo.logoSvg).toContain("<text");
    expect(logo.logoSvg).toContain("Fern &lt;script&gt;");
    expect(logo.logoSvg).not.toContain("<script>");
    expect(existsSync(fromDataRelative(logo.logoPngPath))).toBe(true);
    expect(await renderLogo(p.id, { ...kit("x"), palette: null })).toBeNull();
  });
});

async function dripperProject(name: string) {
  const p = await createProject(name);
  const html = readFileSync(path.join(__dirname, "../fixtures/site/product.html"), "utf8");
  const parsed = parseProductHtml(html, "https://shop.example/product.html");
  await updateProject(p.id, {
    inputs: {
      urls: ["https://shop.example/product.html"],
      context: { ...(await getProject(p.id)).inputs.context, tone: "Cozy" },
    },
    extractions: [
      SourceExtraction.parse({
        ...parsed,
        url: "https://shop.example/product.html",
        sourceDomain: "shop.example",
        fetchMethod: "static",
        fetchedAt: new Date().toISOString(),
      }),
    ],
  });
  await ingestImage(
    p.id,
    readFileSync(path.join(__dirname, "../fixtures/site/images/dripper-1.jpg")),
    { origin: "upload" },
  );
  return p;
}

describe("brand step (fixture mode)", () => {
  it("runs analysis if needed, then builds names, palette, fonts and logo", async () => {
    const p = await dripperProject("Brand");
    const res = await runBrand(ctxFor(p.id), { loadFont: noFont });
    const project = await getProject(p.id);
    const kit = project.brandKit!;
    expect(project.analysis).not.toBeNull();
    expect(kit.nameCandidates).toHaveLength(6);
    for (const c of kit.nameCandidates) {
      expect(nameIsUsable(c.checks!)).toBe(true);
      expect(c.name.toLowerCase()).not.toContain("kilnworks");
      expect(c.domainSuggestion).toMatch(/^[a-z0-9-]+\.com$/);
    }
    expect(kit.selectedName).toBe(kit.nameCandidates[0]!.name);
    expect(res.name).toBe(kit.selectedName);
    expect(kit.tagline.length).toBeLessThanOrEqual(60);
    expect(palettePassesAA(kit.palette!)).toBe(true);
    expect(kit.fonts!.heading).toMatchObject({ family: "Lora", shopifyHandle: "lora_n4" });
    expect(kit.fonts!.body.inShopifyLibrary).toBe(true);
    expect(kit.voice!.do.length).toBeGreaterThanOrEqual(4);
    expect(kit.logoSvg).toContain("<svg");
    expect(project.steps.brand.status).toBe("ready");
  });

  it("puts the merchant's own brand name first and uses it", async () => {
    const p = await dripperProject("Own name");
    const proj = await getProject(p.id);
    await updateProject(p.id, {
      inputs: { ...proj.inputs, context: { ...proj.inputs.context, brandName: "Fern Pottery" } },
    });
    await runBrand(ctxFor(p.id), { loadFont: noFont });
    const kit = (await getProject(p.id)).brandKit!;
    expect(kit.nameCandidates[0]!.name).toBe("Fern Pottery");
    expect(kit.nameCandidates[0]!.rationale).toBe("Your existing brand name.");
    expect(kit.selectedName).toBe("Fern Pottery");

    // Choosing another name rebuilds the details for it.
    await runBrandDetails(ctxFor(p.id), { name: "Clay Morning", loadFont: noFont });
    const after = (await getProject(p.id)).brandKit!;
    expect(after.selectedName).toBe("Clay Morning");
    expect(after.nameCandidates.map((c) => c.name)).toContain("Clay Morning");
  });
});

describe("brand generation (live path with a scripted client)", () => {
  const usage = { input_tokens: 10, output_tokens: 10 };
  const tool = (name: string, input: unknown) => ({
    role: "assistant",
    stop_reason: "tool_use",
    usage,
    content: [{ type: "tool_use", id: `tu_${fake.queue.length}`, name, input }],
  });
  beforeEach(() => {
    process.env.AI_MODE = "live";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    resetEnvCache();
    fake.queue.length = 0;
    fake.requests.length = 0;
  });
  afterEach(() => {
    process.env.AI_MODE = "fixture";
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvCache();
  });

  const names = (list: string[]) =>
    list.map((n) => ({ name: n, rationale: "Fits the product.", domainSuggestion: `${n}.com` }));

  it("retries names that fail the code-side checks", async () => {
    const p = await createProject("Live names");
    fake.queue.push(
      tool("record_brand_names", {
        candidates: names(["Brew2Go", "Nike Pour", "Hearth", "Ember", "Linden", "Still"]),
      }),
      tool("record_brand_names", {
        candidates: names(["Kettle Fox", "Hearth", "Ember", "Linden", "Still", "Pourly"]),
      }),
    );
    const out = await generateBrandNames(await getProject(p.id));
    expect(fake.requests).toHaveLength(2);
    const retry = JSON.stringify(fake.requests[1]!.messages);
    expect(retry).toContain("Brew2Go");
    expect(retry).toContain("Nike");
    expect(out.map((c) => c.name)).toEqual([
      "Kettle Fox",
      "Hearth",
      "Ember",
      "Linden",
      "Still",
      "Pourly",
    ]);
    expect(out[0]!.domainSuggestion).toBe("kettlefox.com");
  });

  it("fixes low-contrast palettes in code and resolves fonts", async () => {
    const p = await createProject("Live details");
    fake.queue.push(
      tool("record_brand_kit", {
        tagline: "Slow coffee, poured by hand",
        voice: {
          adjectives: ["warm", "calm", "honest"],
          do: ["a", "Do b", "Do c", "Do d"].map((x) => `Do ${x}`),
          dont: ["Don't a", "Don't b", "Don't c", "Don't use 'limited time' offers"],
        },
        palette: badPalette,
        fonts: { heading: "Cormorant Garamond", body: "Karla" },
      }),
    );
    const { details, contrastChanges } = await generateBrandDetails(
      await getProject(p.id),
      "Hearth",
    );
    expect(fake.requests).toHaveLength(1); // the voice guide may name things to avoid
    expect(palettePassesAA(details.palette!)).toBe(true);
    expect(contrastChanges.length).toBeGreaterThan(0);
    expect(details.fonts!.heading.inShopifyLibrary).toBe(false);
    expect(details.fonts!.body.shopifyHandle).toBe("karla_n4");
  });

  it("rejects a tagline with an unverifiable claim and retries", async () => {
    const p = await createProject("Live tagline");
    const kit = (tagline: string) =>
      tool("record_brand_kit", {
        tagline,
        voice: {
          adjectives: ["a1", "b2", "c3"],
          do: ["d1x", "d2x", "d3x", "d4x"],
          dont: ["e1x", "e2x", "e3x", "e4x"],
        },
        palette: badPalette,
        fonts: { heading: "Lora", body: "Inter" },
      });
    fake.queue.push(kit("The #1 best-selling dripper"), kit("Pour-over, made for slow mornings"));
    const { details } = await generateBrandDetails(await getProject(p.id), "Hearth");
    expect(fake.requests).toHaveLength(2);
    expect(details.tagline).toBe("Pour-over, made for slow mornings");
  });
});

describe("brand kit edits (PATCH)", () => {
  it("re-resolves fonts, normalizes colours, redraws the logo and ignores client logo paths", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const p = await dripperProject("Patch brand");
    await runBrand(ctxFor(p.id), { loadFont: noFont });
    const kit = (await getProject(p.id)).brandKit!;
    const send = (body: unknown) =>
      PATCH(
        new Request(`http://localhost/api/projects/${p.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: p.id }) },
      );
    const res = await send({
      brandKit: {
        ...kit,
        selectedName: "Clay Morning",
        palette: { ...kit.palette!, primary: "#abcdef" },
        fonts: {
          heading: {
            family: "eb garamond",
            shopifyHandle: "bogus",
            inShopifyLibrary: false,
            note: "",
          },
          body: kit.fonts!.body,
        },
        logoSvg: "<svg><script>alert(1)</script></svg>",
        logoPngPath: "../../etc/passwd",
      },
    });
    expect(res.status).toBe(200);
    const after = (await getProject(p.id)).brandKit!;
    expect(after.fonts!.heading).toMatchObject({
      family: "EB Garamond",
      shopifyHandle: "ebgaramond_n4",
      inShopifyLibrary: true,
    });
    expect(after.palette!.primary).toBe("#ABCDEF");
    expect(after.logoSvg).toContain("Clay Morning");
    expect(after.logoSvg).not.toContain("<script>");
    expect(after.logoPngPath).toMatch(/^projects\/.+\/brand\/logo\.png$/);
    expect((await getProject(p.id)).steps.brand.status).toBe("ready");

    // Invalid colours are rejected by validation.
    const bad = await send({ brandKit: { ...after, palette: { ...after.palette!, text: "red" } } });
    expect(bad.status).toBe(400);
  });
});
