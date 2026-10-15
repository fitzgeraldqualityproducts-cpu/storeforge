import { z } from "zod";
import { HexColor } from "./common";

export const NameCandidate = z.object({
  name: z.string().min(2).max(24),
  rationale: z.string(),
  /** Deterministic syntactic checks computed in code (length, pronounceability heuristics). */
  checks: z
    .object({
      length: z.number(),
      pronounceable: z.boolean(),
      hasDigitsOrSymbols: z.boolean(),
      notes: z.array(z.string()),
    })
    .optional(),
  domainSuggestion: z.string(),
});
export type NameCandidate = z.infer<typeof NameCandidate>;

export const Palette = z.object({
  primary: HexColor,
  secondary: HexColor,
  accent: HexColor,
  background: HexColor,
  text: HexColor,
  surface: HexColor,
});
export type Palette = z.infer<typeof Palette>;

export const FontChoice = z.object({
  family: z.string(),
  /** Shopify font_picker handle, e.g. "playfair_display_n4"; null when not in Shopify's library. */
  shopifyHandle: z.string().nullable(),
  inShopifyLibrary: z.boolean(),
  note: z.string().default(""),
});
export type FontChoice = z.infer<typeof FontChoice>;

export const BrandVoice = z.object({
  adjectives: z.array(z.string()).min(1).max(6),
  do: z.array(z.string()).min(1).max(8),
  dont: z.array(z.string()).min(1).max(8),
});
export type BrandVoice = z.infer<typeof BrandVoice>;

export const BrandKit = z.object({
  nameCandidates: z.array(NameCandidate).default([]),
  selectedName: z.string().nullable().default(null),
  tagline: z.string().default(""),
  voice: BrandVoice.nullable().default(null),
  palette: Palette.nullable().default(null),
  fonts: z.object({ heading: FontChoice, body: FontChoice }).nullable().default(null),
  logoSvg: z.string().nullable().default(null),
  logoPngPath: z.string().nullable().default(null),
  /** True when the SVG wordmark is outlined paths; false when it fell back to live <text>. */
  logoOutlined: z.boolean().default(false),
});
export type BrandKit = z.infer<typeof BrandKit>;
