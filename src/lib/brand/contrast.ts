import type { Palette } from "@/lib/schemas";

/** WCAG 2.x AA minimum for normal-size text. */
export const AA_NORMAL = 4.5;
/** WCAG 2.x AA minimum for large text and UI components. */
export const AA_LARGE = 3;

export function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Invalid hex colour: ${hex}`);
  return `#${h.toUpperCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** Relative luminance per WCAG 2.x (sRGB). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/**
 * Shift `fg`'s lightness (keeping hue and saturation) until it reaches `min` contrast against
 * `bg`. Moves away from the background's luminance; if that can't reach the target, tries the
 * other direction; falls back to black or white, whichever contrasts more.
 */
export function adjustForContrast(fg: string, bg: string, min = AA_NORMAL): string {
  const start = normalizeHex(fg);
  if (contrastRatio(start, bg) >= min) return start;
  const [h, s, l0] = rgbToHsl(hexToRgb(start));
  const bgDark = relativeLuminance(bg) < 0.18;
  for (const dir of bgDark ? [1, -1] : [-1, 1]) {
    for (let l = l0; l >= 0 && l <= 1; l += dir * 0.01) {
      const candidate = rgbToHex(hslToRgb([h, s, Math.max(0, Math.min(1, l))]));
      if (contrastRatio(candidate, bg) >= min) return candidate;
    }
  }
  return contrastRatio("#000000", bg) >= contrastRatio("#FFFFFF", bg) ? "#000000" : "#FFFFFF";
}

export interface ContrastCheck {
  id: "text_background" | "text_surface" | "button" | "accent";
  label: string;
  fg: keyof Palette;
  bg: keyof Palette;
  ratio: number;
  min: number;
  pass: boolean;
  required: boolean;
}

/** The pairs the storefront actually renders. Required pairs must pass before export. */
const PAIRS: Omit<ContrastCheck, "ratio" | "pass">[] = [
  {
    id: "text_background",
    label: "Body text on page background",
    fg: "text",
    bg: "background",
    min: AA_NORMAL,
    required: true,
  },
  {
    id: "text_surface",
    label: "Body text on cards and sections",
    fg: "text",
    bg: "surface",
    min: AA_NORMAL,
    required: true,
  },
  {
    id: "button",
    label: "Button label (background colour) on primary button",
    fg: "background",
    bg: "primary",
    min: AA_NORMAL,
    required: true,
  },
  {
    id: "accent",
    label: "Accent highlights and icons on the page background",
    fg: "accent",
    bg: "background",
    min: AA_LARGE,
    required: false,
  },
];

export function checkPalette(p: Palette): ContrastCheck[] {
  return PAIRS.map((pair) => {
    const ratio = contrastRatio(p[pair.fg], p[pair.bg]);
    return { ...pair, ratio: Math.round(ratio * 100) / 100, pass: ratio >= pair.min };
  });
}

export function palettePassesAA(p: Palette): boolean {
  return checkPalette(p).every((c) => !c.required || c.pass);
}

/**
 * Make a palette pass every required check by adjusting colours in code: the text colour
 * against background and surface, then the primary colour against the button label.
 * Returns the fixed palette and a human-readable list of changes.
 */
export function enforcePalette(input: Palette): { palette: Palette; changes: string[] } {
  const p: Palette = {
    primary: normalizeHex(input.primary),
    secondary: normalizeHex(input.secondary),
    accent: normalizeHex(input.accent),
    background: normalizeHex(input.background),
    text: normalizeHex(input.text),
    surface: normalizeHex(input.surface),
  };
  const changes: string[] = [];
  const set = (key: keyof Palette, value: string, why: string) => {
    if (value !== p[key]) {
      changes.push(`${key} ${p[key]} → ${value} (${why})`);
      p[key] = value;
    }
  };
  // The text colour must work on both background and surface: fix against whichever is closer.
  const worst =
    contrastRatio(p.text, p.background) <= contrastRatio(p.text, p.surface)
      ? p.background
      : p.surface;
  set("text", adjustForContrast(p.text, worst, AA_NORMAL), "text contrast");
  if (contrastRatio(p.text, p.background) < AA_NORMAL)
    set("text", adjustForContrast(p.text, p.background, AA_NORMAL), "text on background");
  if (contrastRatio(p.text, p.surface) < AA_NORMAL) {
    // Background and surface pull in opposite directions; bring the surface closer instead.
    set("surface", adjustForContrast(p.surface, p.text, AA_NORMAL), "text on surface");
  }
  set("primary", adjustForContrast(p.primary, p.background, AA_NORMAL), "button label contrast");
  return { palette: p, changes };
}
