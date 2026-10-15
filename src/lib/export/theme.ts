import { contrastRatio } from "@/lib/brand/contrast";
import { themeHandle } from "@/lib/brand/fonts";
import type { BrandKit, Palette, ProductListing, StoreContent } from "@/lib/schemas";
import dawn from "./dawn/dawn-schema.json";

/**
 * Dawn theme files built from the brand kit and store content. Setting ids, select options and
 * ranges come from Dawn's own section schemas (vendored in ./dawn, see DAWN-LICENSE.md), and
 * `validateDawnTheme` checks every generated value against them.
 */

export const DAWN_VERSION = dawn.themeVersion;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
interface SectionJson {
  type: string;
  settings: Record<string, Json>;
  blocks?: Record<string, { type: string; settings: Record<string, Json> }>;
  block_order?: string[];
  disabled?: boolean;
}
export interface TemplateJson {
  name?: string;
  type?: string;
  sections: Record<string, SectionJson>;
  order: string[];
}

export interface DawnTheme {
  "templates/index.json": TemplateJson;
  "config/settings_data.json": { current: Record<string, Json> };
  "sections/header-group.json": TemplateJson;
  "sections/footer-group.json": TemplateJson;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Dawn `richtext` settings must be wrapped in block tags. */
const rich = (s: string) => `<p>${esc(s)}</p>`;

/** Pick whichever of two colours reads better on `bg`. */
function readable(bg: string, a: string, b: string) {
  return contrastRatio(a, bg) >= contrastRatio(b, bg) ? a : b;
}

/** Five Dawn colour schemes from the brand palette. Button labels sit on the button colour. */
export function colorSchemes(p: Palette) {
  const scheme = (background: string, text: string, button: string, label: string) => ({
    settings: {
      background,
      background_gradient: "",
      text,
      button,
      button_label: label,
      secondary_button_label: text,
      shadow: p.text,
    },
  });
  const onPrimary = readable(p.primary, p.background, p.text);
  const onAccent = readable(p.accent, p.background, p.text);
  return {
    // 1: page default. 2: section/surface. 3: primary band. 4: inverse. 5: accent (sale badges).
    "scheme-1": scheme(p.background, p.text, p.primary, onPrimary),
    "scheme-2": scheme(p.surface, p.text, p.primary, onPrimary),
    "scheme-3": scheme(p.primary, onPrimary, onPrimary, p.primary),
    "scheme-4": scheme(p.text, p.background, p.background, p.text),
    "scheme-5": scheme(p.accent, onAccent, onAccent, p.accent),
  };
}

export function buildDawnTheme(input: {
  brand: BrandKit;
  content: StoreContent;
  listing: ProductListing | null;
}): DawnTheme {
  const { brand, content, listing } = input;
  const productHandle = listing?.handle ?? null;
  const productLink = productHandle
    ? `shopify://products/${productHandle}`
    : "shopify://collections/all";
  const sections: Record<string, SectionJson> = {};
  const order: string[] = [];
  const put = (id: string, s: SectionJson) => {
    sections[id] = s;
    order.push(id);
  };

  for (const s of content.homepageSections) {
    switch (s.type) {
      case "hero":
        put("hero", {
          type: "image-banner",
          settings: {
            image_overlay_opacity: 0,
            image_height: "medium",
            image_behavior: "none",
            desktop_content_position: "middle-left",
            desktop_content_alignment: "left",
            show_text_box: true,
            color_scheme: "scheme-2",
            stack_images_on_mobile: true,
            mobile_content_alignment: "left",
            show_text_below: true,
          },
          blocks: {
            heading: {
              type: "heading",
              settings: { heading: esc(s.headline), heading_size: "h0" },
            },
            text: { type: "text", settings: { text: esc(s.subheadline), text_style: "body" } },
            buttons: {
              type: "buttons",
              settings: {
                button_label_1: s.ctaLabel,
                button_link_1: productLink,
                button_style_secondary_1: false,
                button_label_2: "",
                button_link_2: "",
                button_style_secondary_2: false,
              },
            },
          },
          block_order: ["heading", "text", "buttons"],
        });
        break;
      case "featured_product":
        put("featured_product", {
          type: "featured-product",
          settings: {
            product: productHandle ?? "",
            color_scheme: "scheme-1",
            secondary_background: false,
            media_size: "medium",
            constrain_to_viewport: true,
            media_fit: "contain",
            media_position: "left",
            image_zoom: "lightbox",
            hide_variants: false,
            enable_video_looping: false,
            padding_top: 36,
            padding_bottom: 36,
          },
          blocks: {
            title: { type: "title", settings: { heading_size: "h1" } },
            price: { type: "price", settings: {} },
            variant_picker: {
              type: "variant_picker",
              settings: { picker_type: "button", swatch_shape: "circle" },
            },
            buy_buttons: {
              type: "buy_buttons",
              settings: { show_dynamic_checkout: true, show_gift_card_recipient: false },
            },
          },
          block_order: ["title", "price", "variant_picker", "buy_buttons"],
        });
        break;
      case "benefits":
      case "trust_badges": {
        const items =
          s.type === "benefits"
            ? s.items.map((b) => ({ title: b.title, text: b.text }))
            : s.badges.map((b) => ({ title: b.label, text: "" }));
        const blocks: NonNullable<SectionJson["blocks"]> = {};
        items.forEach((it, i) => {
          blocks[`column_${i + 1}`] = {
            type: "column",
            settings: {
              title: esc(it.title),
              text: it.text ? rich(it.text) : "",
              link_label: "",
              link: "",
            },
          };
        });
        put(s.type, {
          type: "multicolumn",
          settings: {
            title: esc(s.heading),
            heading_size: "h1",
            image_width: "third",
            image_ratio: "adapt",
            button_label: "",
            button_link: "",
            columns_desktop: Math.min(6, Math.max(1, items.length)),
            column_alignment: s.type === "trust_badges" ? "center" : "left",
            background_style: s.type === "trust_badges" ? "none" : "primary",
            color_scheme: "scheme-1",
            columns_mobile: "1",
            swipe_on_mobile: false,
            padding_top: 36,
            padding_bottom: 36,
          },
          blocks,
          block_order: Object.keys(blocks),
        });
        break;
      }
      case "social_proof":
        // Not exported: the placeholder note is for the merchant, not customers. Add a reviews
        // app block here once there are real reviews (see README-IMPORT-STEPS.md).
        break;
      case "faq": {
        const blocks: NonNullable<SectionJson["blocks"]> = {};
        s.items.forEach((f, i) => {
          blocks[`question_${i + 1}`] = {
            type: "collapsible_row",
            settings: {
              heading: f.question,
              icon: "question_mark",
              row_content: rich(f.answer),
              page: "",
            },
          };
        });
        put("faq", {
          type: "collapsible-content",
          settings: {
            caption: "",
            heading: esc(s.heading),
            heading_size: "h1",
            heading_alignment: "center",
            layout: "none",
            container_color_scheme: "scheme-2",
            color_scheme: "scheme-1",
            open_first_collapsible_row: false,
            image_ratio: "adapt",
            desktop_layout: "image_second",
            padding_top: 36,
            padding_bottom: 36,
          },
          blocks,
          block_order: Object.keys(blocks),
        });
        break;
      }
      case "newsletter":
        put("newsletter", {
          type: "newsletter",
          settings: {
            color_scheme: "scheme-2",
            full_width: true,
            padding_top: 40,
            padding_bottom: 52,
          },
          blocks: {
            heading: { type: "heading", settings: { heading: esc(s.heading), heading_size: "h1" } },
            paragraph: { type: "paragraph", settings: { text: rich(s.text) } },
            email_form: { type: "email_form", settings: {} },
          },
          block_order: ["heading", "paragraph", "email_form"],
        });
        break;
      case "rich_text":
        put(`rich_text_${order.length}`, {
          type: "rich-text",
          settings: {
            desktop_content_position: "center",
            content_alignment: "center",
            color_scheme: "scheme-1",
            full_width: true,
            padding_top: 40,
            padding_bottom: 52,
          },
          blocks: {
            heading: { type: "heading", settings: { heading: esc(s.heading), heading_size: "h1" } },
            text: { type: "text", settings: { text: rich(s.text) } },
          },
          block_order: ["heading", "text"],
        });
        break;
    }
  }

  const palette = brand.palette;
  const social = content.settings.socialLinks;
  const current: Record<string, Json> = {
    ...(dawn.defaultPreset as Record<string, Json>),
    ...(palette ? { color_schemes: colorSchemes(palette) } : {}),
    ...(brand.fonts
      ? {
          type_header_font: themeHandle(brand.fonts.heading),
          type_body_font: themeHandle(brand.fonts.body),
        }
      : {}),
    // Dawn's shipped preset says "none", which its own schema doesn't list; use the default.
    animations_hover_elements: "default",
    logo_width: 140,
    social_facebook_link: social.facebook,
    social_instagram_link: social.instagram,
    social_youtube_link: social.youtube,
    social_tiktok_link: social.tiktok,
    social_pinterest_link: social.pinterest,
    brand_headline: esc(content.settings.tagline || brand.tagline || ""),
  };

  const header: TemplateJson = {
    name: "t:sections.header.name",
    type: "header",
    sections: {
      "announcement-bar": {
        type: "announcement-bar",
        settings: {
          auto_rotate: false,
          change_slides_speed: 5,
          color_scheme: "scheme-3",
          show_line_separator: false,
          show_social: false,
          enable_country_selector: false,
          enable_language_selector: false,
        },
        blocks: content.announcementBar
          ? {
              announcement: {
                type: "announcement",
                settings: { text: content.announcementBar, link: "" },
              },
            }
          : {},
        block_order: content.announcementBar ? ["announcement"] : [],
      },
      header: {
        type: "header",
        settings: {
          logo_position: "middle-left",
          mobile_logo_position: "center",
          menu: "main-menu",
          menu_type_desktop: "dropdown",
          sticky_header_type: "on-scroll-up",
          show_line_separator: true,
          color_scheme: "scheme-1",
          menu_color_scheme: "scheme-1",
          enable_country_selector: false,
          enable_language_selector: false,
          margin_bottom: 0,
          padding_top: 20,
          padding_bottom: 20,
        },
      },
    },
    order: ["announcement-bar", "header"],
  };

  const newsletter = content.homepageSections.find((s) => s.type === "newsletter");
  const footer: TemplateJson = {
    name: "t:sections.footer.name",
    type: "footer",
    sections: {
      footer: {
        type: "footer",
        settings: {
          color_scheme: "scheme-2",
          newsletter_enable: true,
          newsletter_heading: esc(
            newsletter?.type === "newsletter" ? newsletter.heading : "Subscribe to our emails",
          ),
          enable_follow_on_shop: true,
          show_social: true,
          enable_country_selector: false,
          enable_language_selector: false,
          payment_enable: true,
          show_policy: true,
          margin_top: 0,
          padding_top: 36,
          padding_bottom: 36,
        },
        blocks: {
          brand: { type: "brand_information", settings: { show_social: true } },
          links: { type: "link_list", settings: { heading: "Help", menu: "footer" } },
        },
        block_order: ["brand", "links"],
      },
    },
    order: ["footer"],
  };

  return {
    "templates/index.json": { sections, order },
    "config/settings_data.json": { current },
    "sections/header-group.json": header,
    "sections/footer-group.json": footer,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Validation against Dawn's schemas                                                          */
/* ------------------------------------------------------------------------------------------ */

interface SettingDef {
  id: string;
  type: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}
type SectionDef = {
  max_blocks: number | null;
  settings: SettingDef[];
  blocks: { type: string; limit: number | null; settings: SettingDef[] }[];
};
const SECTIONS = dawn.sections as Record<string, SectionDef>;
const HEX = /^#[0-9a-f]{6}$/i;
const SCHEMES = ["scheme-1", "scheme-2", "scheme-3", "scheme-4", "scheme-5"];

function checkSetting(
  def: SettingDef | undefined,
  id: string,
  value: Json,
  where: string,
): string[] {
  if (!def) return [`${where}: "${id}" isn't a setting in Dawn ${DAWN_VERSION}`];
  const p = `${where}.${id}`;
  switch (def.type) {
    case "checkbox":
      return typeof value === "boolean" ? [] : [`${p}: expected true/false`];
    case "range": {
      if (typeof value !== "number") return [`${p}: expected a number`];
      const errs: string[] = [];
      if (def.min != null && value < def.min) errs.push(`${p}: ${value} is below ${def.min}`);
      if (def.max != null && value > def.max) errs.push(`${p}: ${value} is above ${def.max}`);
      if (def.step && def.min != null && (value - def.min) % def.step !== 0)
        errs.push(`${p}: ${value} isn't a multiple of ${def.step} from ${def.min}`);
      return errs;
    }
    case "select":
      return typeof value === "string" && def.options?.includes(value)
        ? []
        : [`${p}: "${String(value)}" isn't one of ${def.options?.join(", ")}`];
    case "color_scheme":
      return typeof value === "string" && SCHEMES.includes(value)
        ? []
        : [`${p}: unknown colour scheme`];
    case "richtext":
      return typeof value === "string" && (value === "" || /^<(p|ul|ol|h[1-6])\b/.test(value))
        ? []
        : [`${p}: rich text must start with a block tag such as <p>`];
    case "inline_richtext":
      return typeof value === "string" && !/<\/?(p|div|ul|ol|li|h[1-6])\b/i.test(value)
        ? []
        : [`${p}: inline rich text can't contain block tags`];
    case "text":
    case "url":
    case "product":
    case "page":
    case "link_list":
    case "liquid":
      return typeof value === "string" ? [] : [`${p}: expected text`];
    default:
      return [];
  }
}

function checkSection(id: string, s: SectionJson, where: string): string[] {
  const def = SECTIONS[s.type];
  if (!def) return [`${where}.${id}: section type "${s.type}" isn't in Dawn ${DAWN_VERSION}`];
  const errs: string[] = [];
  for (const [k, v] of Object.entries(s.settings)) {
    errs.push(
      ...checkSetting(
        def.settings.find((d) => d.id === k),
        k,
        v,
        `${where}.${id}`,
      ),
    );
  }
  const blocks = s.blocks ?? {};
  const order = s.block_order ?? [];
  if (order.length !== Object.keys(blocks).length || order.some((b) => !(b in blocks)))
    errs.push(`${where}.${id}: block_order doesn't match blocks`);
  if (def.max_blocks != null && order.length > def.max_blocks)
    errs.push(`${where}.${id}: ${order.length} blocks; Dawn allows ${def.max_blocks}`);
  const counts = new Map<string, number>();
  for (const [bid, b] of Object.entries(blocks)) {
    const bdef = def.blocks.find((d) => d.type === b.type);
    if (!bdef) {
      errs.push(`${where}.${id}.${bid}: block type "${b.type}" isn't allowed in ${s.type}`);
      continue;
    }
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    if (bdef.limit != null && counts.get(b.type)! > bdef.limit)
      errs.push(`${where}.${id}: more than ${bdef.limit} "${b.type}" block(s)`);
    for (const [k, v] of Object.entries(b.settings)) {
      errs.push(
        ...checkSetting(
          bdef.settings.find((d) => d.id === k),
          k,
          v,
          `${where}.${id}.${bid}`,
        ),
      );
    }
  }
  return errs;
}

function checkTemplate(t: TemplateJson, where: string): string[] {
  const errs: string[] = [];
  if (!t || typeof t !== "object" || !t.sections || !Array.isArray(t.order))
    return [`${where}: needs "sections" and "order"`];
  if (t.order.length !== Object.keys(t.sections).length || t.order.some((o) => !(o in t.sections)))
    errs.push(`${where}: order doesn't match sections`);
  for (const [id, s] of Object.entries(t.sections)) errs.push(...checkSection(id, s, where));
  return errs;
}

/**
 * Parse each file from its serialized text (as written to the bundle) and check it against
 * Dawn's section and theme-settings schemas.
 */
export function validateDawnTheme(files: Record<string, string>): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(files)) {
    try {
      parsed[name] = JSON.parse(text);
    } catch (e) {
      issues.push(`${name}: invalid JSON (${(e as Error).message})`);
    }
  }
  for (const name of [
    "templates/index.json",
    "sections/header-group.json",
    "sections/footer-group.json",
  ]) {
    if (parsed[name]) issues.push(...checkTemplate(parsed[name] as TemplateJson, name));
  }
  const data = parsed["config/settings_data.json"] as
    { current?: Record<string, Json> } | undefined;
  if (data) {
    const current = data.current;
    if (!current || typeof current !== "object")
      issues.push('config/settings_data.json: needs a "current" object');
    else {
      const defs = dawn.globalSettings as SettingDef[];
      for (const [k, v] of Object.entries(current)) {
        if (k === "color_schemes") {
          const schemes = v as Record<string, { settings: Record<string, string> }>;
          for (const s of SCHEMES) {
            const set = schemes?.[s]?.settings;
            if (!set) {
              issues.push(`config/settings_data.json: missing ${s}`);
              continue;
            }
            for (const f of dawn.colorSchemeFields) {
              if (!(f in set)) issues.push(`config/settings_data.json: ${s} is missing ${f}`);
              else if (f !== "background_gradient" && !HEX.test(set[f]!))
                issues.push(`config/settings_data.json: ${s}.${f} "${set[f]}" isn't a hex colour`);
            }
          }
          continue;
        }
        const def = defs.find((d) => d.id === k);
        if (!def) {
          issues.push(
            `config/settings_data.json: "${k}" isn't a Dawn ${DAWN_VERSION} theme setting`,
          );
          continue;
        }
        if (def.type === "font_picker") {
          if (typeof v !== "string" || !/^[a-z0-9_]+_[nio][1-9]$/.test(v))
            issues.push(
              `config/settings_data.json: ${k} "${String(v)}" isn't a Shopify font handle`,
            );
          continue;
        }
        issues.push(...checkSetting(def, k, v, "config/settings_data.json"));
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
