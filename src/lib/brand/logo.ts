import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, Path, type Font, type Glyph } from "opentype.js";
import sharp from "sharp";
import { dataDir, env } from "@/lib/config";
import { log } from "@/lib/log";
import type { BrandKit, Palette } from "@/lib/schemas";
import { projectDir, toDataRelative } from "@/lib/security/paths";
import { AA_LARGE, contrastRatio } from "./contrast";
import { findLibraryFont } from "./fonts";

export type FontLoader = (family: string, weight: number) => Promise<ArrayBuffer | null>;

const FONT_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
}

/**
 * Download a TrueType file for a Google Fonts family, cached under data/cache/fonts.
 * The legacy CSS API serves TTF (which opentype.js parses) to clients that don't advertise
 * WOFF2 support. Only fonts.gstatic.com URLs are followed.
 */
export const googleFontLoader: FontLoader = async (family, weight) => {
  const slug = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${weight}.ttf`;
  const cacheFile = path.join(dataDir("cache", "fonts"), slug);
  try {
    const cached = await readFile(cacheFile);
    return cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
  } catch {
    // not cached yet
  }
  if (env().FONT_DOWNLOADS === "off") return null;
  try {
    const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${weight}`;
    const cssRes = await fetchWithTimeout(cssUrl);
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const m = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.ttf)\)/);
    if (!m) return null;
    const fontRes = await fetchWithTimeout(m[1]!);
    if (!fontRes.ok) return null;
    const buf = await fontRes.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > FONT_MAX_BYTES) return null;
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, new Uint8Array(buf));
    return buf;
  } catch (err) {
    log.warn("logo.font_fetch_failed", { family, weight, error: err });
    return null;
  }
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wordmark colour: the brand primary when it reads on the background, otherwise the text colour. */
export function wordmarkColor(p: Palette): string {
  return contrastRatio(p.primary, p.background) >= AA_LARGE ? p.primary : p.text;
}

const FONT_SIZE = 120;
/**
 * Lay the name out glyph by glyph (advance widths + pair kerning). This bypasses opentype.js's
 * shaping engine, which throws on some GSUB lookup formats used by popular Google Fonts; a
 * wordmark doesn't need ligatures or contextual alternates.
 */
function wordmarkPath(font: Font, name: string, x: number, y: number) {
  const scale = FONT_SIZE / font.unitsPerEm;
  const path = new Path();
  let cursor = x;
  let prev: Glyph | null = null;
  for (const ch of name) {
    const glyph = font.charToGlyph(ch);
    if (prev) cursor += font.getKerningValue(prev, glyph) * scale;
    path.extend(glyph.getPath(cursor, y, FONT_SIZE));
    cursor += (glyph.advanceWidth ?? 0) * scale;
    prev = glyph;
  }
  return path;
}

function outlinedSvg(font: Font, name: string, color: string): string {
  const probe = wordmarkPath(font, name, 0, 0).getBoundingBox();
  if (!Number.isFinite(probe.x1) || probe.x2 - probe.x1 <= 0) {
    throw new Error("Font has no outlines for these characters");
  }
  const pad = Math.round(FONT_SIZE * 0.18);
  const w = Math.ceil(probe.x2 - probe.x1) + pad * 2;
  const h = Math.ceil(probe.y2 - probe.y1) + pad * 2;
  const d = wordmarkPath(font, name, pad - probe.x1, pad - probe.y1).toPathData(2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="logo-title">`,
    `<title id="logo-title">${esc(name)}</title>`,
    `<path fill="${color}" d="${d}"/>`,
    `</svg>`,
  ].join("");
}

function textSvg(name: string, family: string, weight: number, color: string, serif: boolean) {
  const pad = Math.round(FONT_SIZE * 0.18);
  const w = Math.ceil(name.length * FONT_SIZE * 0.62) + pad * 2;
  const h = Math.ceil(FONT_SIZE * 1.05) + pad * 2;
  const stack = serif
    ? `'${esc(family)}', Georgia, 'DejaVu Serif', serif`
    : `'${esc(family)}', 'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="logo-title">`,
    `<title id="logo-title">${esc(name)}</title>`,
    `<text x="${w / 2}" y="${pad + FONT_SIZE * 0.82}" text-anchor="middle" font-family="${stack}" font-size="${FONT_SIZE}" font-weight="${weight}" fill="${color}">${esc(name)}</text>`,
    `</svg>`,
  ].join("");
}

export interface LogoResult {
  logoSvg: string;
  logoPngPath: string;
  logoOutlined: boolean;
}

/**
 * Programmatic wordmark: the brand name set in the heading font and converted to outlines
 * (so it renders identically everywhere), coloured from the palette, plus a 1200px-wide
 * transparent PNG. If the font can't be downloaded, falls back to live SVG text with a
 * generic font stack and says so (logoOutlined=false).
 */
export async function renderLogo(
  projectId: string,
  kit: Pick<BrandKit, "selectedName" | "palette" | "fonts">,
  opts: { loadFont?: FontLoader } = {},
): Promise<LogoResult | null> {
  const name = kit.selectedName?.trim();
  if (!name || !kit.palette || !kit.fonts) return null;
  const family = kit.fonts.heading.family;
  const lib = findLibraryFont(family);
  const weight = lib && !lib.bold ? 400 : 700;
  const color = wordmarkColor(kit.palette);
  const load = opts.loadFont ?? googleFontLoader;

  let svg: string | null = null;
  for (const w of weight === 700 ? [700, 400] : [400]) {
    const buf = await load(family, w);
    if (!buf) continue;
    try {
      svg = outlinedSvg(parse(buf), name, color);
      break;
    } catch (err) {
      log.warn("logo.font_parse_failed", { family, weight: w, error: err });
    }
  }
  const outlined = svg !== null;
  const serif = lib
    ? lib.category === "serif" || lib.category === "display"
    : /serif|garamond|bodoni/i.test(family);
  svg ??= textSvg(name, family, weight, color, serif);

  const dir = projectDir(projectId, "brand");
  await mkdir(dir, { recursive: true });
  const svgFile = path.join(dir, "logo.svg");
  const pngFile = path.join(dir, "logo.png");
  await writeFile(svgFile, svg, "utf8");
  const png = await sharp(Buffer.from(svg), { density: 300 })
    .resize({ width: 1200, withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(pngFile, png);
  return { logoSvg: svg, logoPngPath: toDataRelative(pngFile), logoOutlined: outlined };
}
