import type { FontChoice } from "@/lib/schemas";

export type FontCategory = "serif" | "sans" | "display" | "mono";

export interface LibraryFont {
  family: string;
  /** Regular-weight handle for the theme's font_picker settings. */
  handle: string;
  category: FontCategory;
  /** Has a 700 weight in Shopify's library (used for the logo and headings). */
  bold: boolean;
}

/**
 * Google Fonts families verified against Shopify's font library
 * (https://shopify.dev/docs/storefronts/themes/architecture/settings/fonts, checked 2026-10-15).
 * Handles are copied exactly from that page; note irregular ones such as EB Garamond →
 * "ebgaramond_n4". Families not listed here may still exist in the library but are treated as
 * "requires theme upload" rather than guessed.
 */
export const SHOPIFY_LIBRARY_FONTS: LibraryFont[] = [
  // Serif
  { family: "Playfair Display", handle: "playfair_display_n4", category: "serif", bold: true },
  { family: "Lora", handle: "lora_n4", category: "serif", bold: true },
  { family: "Libre Baskerville", handle: "libre_baskerville_n4", category: "serif", bold: true },
  { family: "Libre Bodoni", handle: "libre_bodoni_n4", category: "serif", bold: true },
  { family: "Libre Caslon Text", handle: "libre_caslon_text_n4", category: "serif", bold: true },
  { family: "EB Garamond", handle: "ebgaramond_n4", category: "serif", bold: true },
  { family: "DM Serif Display", handle: "dm_serif_display_n4", category: "serif", bold: false },
  { family: "DM Serif Text", handle: "dm_serif_text_n4", category: "serif", bold: false },
  { family: "Crimson Pro", handle: "crimson_pro_n4", category: "serif", bold: true },
  { family: "Crimson Text", handle: "crimson_text_n4", category: "serif", bold: true },
  { family: "Domine", handle: "domine_n4", category: "serif", bold: true },
  { family: "Merriweather", handle: "merriweather_n4", category: "serif", bold: true },
  { family: "PT Serif", handle: "pt_serif_n4", category: "serif", bold: true },
  { family: "Petrona", handle: "petrona_n4", category: "serif", bold: true },
  { family: "Vollkorn", handle: "vollkorn_n4", category: "serif", bold: true },
  { family: "Alegreya", handle: "alegreya_n4", category: "serif", bold: true },
  { family: "Andada Pro", handle: "andada_pro_n4", category: "serif", bold: true },
  { family: "Source Serif 4", handle: "source_serif_4_n4", category: "serif", bold: true },
  { family: "IBM Plex Serif", handle: "ibm_plex_serif_n4", category: "serif", bold: true },
  { family: "Instrument Serif", handle: "instrument_serif_n4", category: "serif", bold: false },
  { family: "Roboto Slab", handle: "roboto_slab_n4", category: "serif", bold: true },
  { family: "Rasa", handle: "rasa_n4", category: "serif", bold: true },
  { family: "Martel", handle: "martel_n4", category: "serif", bold: true },
  { family: "Manuale", handle: "manuale_n4", category: "serif", bold: true },
  { family: "Old Standard TT", handle: "old_standard_tt_n4", category: "serif", bold: true },
  { family: "Unna", handle: "unna_n4", category: "serif", bold: true },
  { family: "Ovo", handle: "ovo_n4", category: "serif", bold: false },
  { family: "Marcellus", handle: "marcellus_n4", category: "serif", bold: false },
  // Display
  { family: "Abril Fatface", handle: "abril_fatface_n4", category: "display", bold: false },
  { family: "Vidaloka", handle: "vidaloka_n4", category: "display", bold: false },
  { family: "Syne", handle: "syne_n4", category: "display", bold: true },
  { family: "Archivo Black", handle: "archivo_black_n4", category: "display", bold: false },
  { family: "Oswald", handle: "oswald_n4", category: "display", bold: true },
  // Sans
  { family: "Assistant", handle: "assistant_n4", category: "sans", bold: true },
  { family: "Inter", handle: "inter_n4", category: "sans", bold: true },
  { family: "Montserrat", handle: "montserrat_n4", category: "sans", bold: true },
  { family: "Poppins", handle: "poppins_n4", category: "sans", bold: true },
  { family: "DM Sans", handle: "dm_sans_n4", category: "sans", bold: true },
  { family: "Karla", handle: "karla_n4", category: "sans", bold: true },
  { family: "Rubik", handle: "rubik_n4", category: "sans", bold: true },
  { family: "Nunito Sans", handle: "nunito_sans_n4", category: "sans", bold: true },
  { family: "Nunito", handle: "nunito_n4", category: "sans", bold: true },
  { family: "Manrope", handle: "manrope_n4", category: "sans", bold: true },
  { family: "Outfit", handle: "outfit_n4", category: "sans", bold: true },
  { family: "Plus Jakarta Sans", handle: "plus_jakarta_sans_n4", category: "sans", bold: true },
  { family: "Space Grotesk", handle: "space_grotesk_n4", category: "sans", bold: true },
  { family: "Archivo", handle: "archivo_n4", category: "sans", bold: true },
  { family: "Barlow", handle: "barlow_n4", category: "sans", bold: true },
  { family: "Instrument Sans", handle: "instrument_sans_n4", category: "sans", bold: true },
  { family: "Libre Franklin", handle: "libre_franklin_n4", category: "sans", bold: true },
  { family: "Lato", handle: "lato_n4", category: "sans", bold: true },
  { family: "Open Sans", handle: "open_sans_n4", category: "sans", bold: true },
  { family: "Source Sans Pro", handle: "source_sans_pro_n4", category: "sans", bold: true },
  { family: "PT Sans", handle: "pt_sans_n4", category: "sans", bold: true },
  { family: "Red Hat Display", handle: "red_hat_display_n4", category: "sans", bold: true },
  { family: "Red Hat Text", handle: "red_hat_text_n4", category: "sans", bold: true },
  { family: "Roboto", handle: "roboto_n4", category: "sans", bold: true },
  { family: "Schibsted Grotesk", handle: "schibsted_grotesk_n4", category: "sans", bold: true },
  { family: "Maven Pro", handle: "maven_pro_n4", category: "sans", bold: true },
  { family: "Tenor Sans", handle: "tenor_sans_n4", category: "sans", bold: false },
  { family: "Varela Round", handle: "varela_round_n4", category: "sans", bold: false },
  // Mono
  { family: "Space Mono", handle: "space_mono_n4", category: "mono", bold: true },
  { family: "Roboto Mono", handle: "roboto_mono_n4", category: "mono", bold: true },
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map(SHOPIFY_LIBRARY_FONTS.map((f) => [key(f.family), f]));

export function findLibraryFont(family: string): LibraryFont | null {
  return BY_KEY.get(key(family)) ?? null;
}

/** Nearest library family for a font that isn't in the library (by rough category). */
export function libraryFallbackFor(family: string): LibraryFont {
  const f = family.toLowerCase();
  const pick = (name: string) => findLibraryFont(name)!;
  if (/mono|code|courier/.test(f)) return pick("Space Mono");
  if (
    /garamond|cormorant|caslon|baskerville|bodoni|didot|fraunces|serif|slab|times|georgia/.test(f)
  )
    return pick("Lora");
  if (/display|black|fatface|poster/.test(f)) return pick("Playfair Display");
  return pick("Assistant");
}

/**
 * Resolve a family name to a FontChoice: exact library handle when verified, otherwise flagged
 * as requiring a theme upload, with the library family the theme will fall back to meanwhile.
 */
export function resolveFont(family: string): FontChoice {
  const clean = family.trim().replace(/\s+/g, " ");
  const lib = findLibraryFont(clean);
  if (lib) {
    return {
      family: lib.family,
      shopifyHandle: lib.handle,
      inShopifyLibrary: true,
      note: `In Shopify's font library (${lib.handle}); select it in Theme settings → Typography.`,
    };
  }
  const fb = libraryFallbackFor(clean);
  return {
    family: clean,
    shopifyHandle: null,
    inShopifyLibrary: false,
    note: `Not verified in Shopify's font library: requires a theme upload (add the font files to the theme's assets and an @font-face rule). Until then, use ${fb.family} (${fb.handle}).`,
  };
}

/** The handle to write into theme settings: the font's own, or the library fallback. */
export function themeHandle(choice: FontChoice): string {
  return choice.shopifyHandle ?? libraryFallbackFor(choice.family).handle;
}

/** Google Fonts CSS2 URL for previewing families in the browser. */
export function googleFontsHref(families: string[]): string {
  const uniq = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
  const q = uniq
    .map((f) => {
      const lib = findLibraryFont(f);
      // Only request weights we know exist; an unknown weight fails the whole request.
      const name = encodeURIComponent(f).replace(/%20/g, "+");
      return lib?.bold ? `family=${name}:wght@400;700` : `family=${name}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/** Families to offer in the editor and to name in the prompt, grouped by category. */
export function libraryFamilies(category?: FontCategory): string[] {
  return SHOPIFY_LIBRARY_FONTS.filter((f) => !category || f.category === category).map(
    (f) => f.family,
  );
}
