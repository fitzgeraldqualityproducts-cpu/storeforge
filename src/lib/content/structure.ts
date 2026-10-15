import { toHandle, truncateAtWord } from "@/lib/listing/text";
import type {
  HomepageSection,
  MenuItem,
  StoreCollection,
  StoreContent,
  StorePage,
} from "@/lib/schemas";

/**
 * Store structure that must be right for Shopify (page handles, policy URLs, menus, the "all"
 * collection) is fixed in code. The model writes the words; this module decides the shape.
 */

export const ANNOUNCEMENT_MAX = 80;
export const FAQ_MIN = 8;
export const FAQ_MAX = 10;

/** Wording of the social-proof placeholder. Never replaced by generated reviews. */
export const SOCIAL_PROOF_NOTE =
  "Add real customer reviews here once you have them. Don't use reviews you didn't receive.";

export const SECTION_ORDER: HomepageSection["type"][] = [
  "hero",
  "featured_product",
  "benefits",
  "social_proof",
  "faq",
  "trust_badges",
  "newsletter",
];

export interface RequiredPage {
  handle: string;
  title: string;
  kind: StorePage["kind"];
}

/** Pages every store gets. Policy handles match Shopify's /policies/<handle> URLs. */
export const REQUIRED_PAGES: RequiredPage[] = [
  { handle: "about-us", title: "About us", kind: "about" },
  { handle: "contact", title: "Contact", kind: "contact" },
  { handle: "faq", title: "FAQ", kind: "faq" },
  { handle: "shipping-policy", title: "Shipping policy", kind: "policy" },
  { handle: "refund-policy", title: "Refund policy", kind: "policy" },
  { handle: "privacy-policy", title: "Privacy policy", kind: "policy" },
  { handle: "terms-of-service", title: "Terms of service", kind: "policy" },
];
export const POLICY_HANDLES = REQUIRED_PAGES.filter((p) => p.kind === "policy").map(
  (p) => p.handle,
);

export const ALL_COLLECTION: StoreCollection = {
  handle: "all",
  title: "All Products",
  descriptionHtml: "",
  rules: null,
};

export const BENEFIT_ICONS = [
  "leaf",
  "shield",
  "truck",
  "sparkle",
  "heart",
  "clock",
  "thermometer",
  "droplet",
  "recycle",
  "star",
  "gift",
  "check",
] as const;
export const BADGE_ICONS = ["truck", "shield", "return", "lock", "leaf", "heart"] as const;

/** Main and footer menus, built from the pages and collections that actually exist. */
export function buildMenus(
  pages: Pick<StorePage, "handle" | "title" | "kind">[],
  collections: Pick<StoreCollection, "handle" | "title">[],
): StoreContent["menus"] {
  const has = (h: string) => pages.some((p) => p.handle === h);
  const page = (handle: string, title: string): MenuItem => ({
    title,
    url: `/pages/${handle}`,
    type: "PAGE",
    handle,
  });
  const main: MenuItem[] = [
    { title: "Home", url: "/", type: "FRONTPAGE", handle: null },
    { title: "Shop", url: "/collections/all", type: "COLLECTION", handle: "all" },
    ...collections
      .filter((c) => c.handle !== "all")
      .slice(0, 2)
      .map((c): MenuItem => ({
        title: c.title,
        url: `/collections/${c.handle}`,
        type: "COLLECTION",
        handle: c.handle,
      })),
  ];
  if (has("about-us")) main.push(page("about-us", "About"));
  if (has("faq")) main.push(page("faq", "FAQ"));
  if (has("contact")) main.push(page("contact", "Contact"));

  const footer: MenuItem[] = [{ title: "Search", url: "/search", type: "SEARCH", handle: null }];
  for (const p of pages.filter((x) => x.kind === "policy")) {
    footer.push({
      title: p.title,
      url: `/policies/${p.handle}`,
      type: "SHOP_POLICY",
      handle: p.handle,
    });
  }
  if (has("contact")) footer.push(page("contact", "Contact"));
  return { main, footer };
}

/** Bracketed placeholders the merchant must fill: [BUSINESS NAME], [RETURN WINDOW], [X]… */
export const PLACEHOLDER_RE = /\[(?!CONFIRM:)([A-Z0-9][A-Z0-9 &'’()/.,+-]{0,60})\]/g;

export interface PlaceholderHit {
  token: string;
  where: string;
}

/** Walk the content and report every [PLACEHOLDER] and [CONFIRM: …] with where it is. */
export function findPlaceholders(content: StoreContent): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  const scan = (text: string, where: string) => {
    for (const m of text.matchAll(PLACEHOLDER_RE)) hits.push({ token: m[0], where });
    for (const m of text.matchAll(/\[CONFIRM:[^\]]+\]/g)) hits.push({ token: m[0], where });
  };
  scan(content.announcementBar, "Announcement bar");
  for (const s of content.homepageSections) {
    if (s.type === "social_proof") continue; // the review placeholder is intentional
    scan(JSON.stringify(s), `Homepage: ${sectionLabel(s.type)}`);
  }
  for (const p of content.pages) scan(`${p.title}\n${p.bodyHtml}`, `Page: ${p.title}`);
  for (const c of content.collections) scan(c.descriptionHtml, `Collection: ${c.title}`);
  return hits;
}

/** Distinct placeholder tokens with how often each appears. */
export function placeholderSummary(content: StoreContent) {
  const by = new Map<string, { token: string; count: number; where: Set<string> }>();
  for (const h of findPlaceholders(content)) {
    const e = by.get(h.token) ?? { token: h.token, count: 0, where: new Set<string>() };
    e.count += 1;
    e.where.add(h.where);
    by.set(h.token, e);
  }
  return [...by.values()].map((e) => ({ token: e.token, count: e.count, where: [...e.where] }));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Replace one placeholder everywhere. Values go into HTML bodies escaped, so a merchant typing
 * "<b>" can't inject markup. Returns a new object.
 */
export function fillPlaceholder(content: StoreContent, token: string, value: string): StoreContent {
  const plain = (s: string) => s.split(token).join(value);
  const html = (s: string) => s.split(token).join(escapeHtml(value));
  const deep = <T>(v: T): T => {
    if (typeof v === "string") return plain(v) as T;
    if (Array.isArray(v)) return v.map(deep) as T;
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) as T;
    return v;
  };
  return {
    ...content,
    announcementBar: plain(content.announcementBar),
    homepageSections: content.homepageSections.map((s) => deep(s)),
    pages: content.pages.map((p) => ({ ...p, title: plain(p.title), bodyHtml: html(p.bodyHtml) })),
    collections: content.collections.map((c) => ({
      ...c,
      descriptionHtml: html(c.descriptionHtml),
    })),
  };
}

export function sectionLabel(type: HomepageSection["type"]) {
  return {
    hero: "Hero",
    featured_product: "Featured product",
    benefits: "Benefits",
    social_proof: "Reviews (placeholder)",
    faq: "FAQ",
    newsletter: "Newsletter",
    trust_badges: "Trust badges",
    rich_text: "Text",
  }[type];
}

/** The homepage FAQ items (empty if the section is missing). */
export function faqItems(content: Pick<StoreContent, "homepageSections">) {
  const s = content.homepageSections.find((x) => x.type === "faq");
  return s && s.type === "faq" ? s.items : [];
}

/**
 * Put generated or edited content into canonical shape: section order, the fixed review
 * placeholder, CTA link to the product, required pages in order, the "all" collection first,
 * code-built menus and length limits. Page HTML is sanitized by the caller (server-only).
 */
export function normalizeContent(
  raw: StoreContent,
  opts: { productHandle: string | null; storeName: string; currency: string; tagline: string },
): StoreContent {
  const sections = [...raw.homepageSections]
    .map((s): HomepageSection => {
      if (s.type === "hero")
        return {
          ...s,
          ctaLink: opts.productHandle ? `/products/${opts.productHandle}` : "/collections/all",
        };
      if (s.type === "social_proof") return { ...s, placeholderNote: SOCIAL_PROOF_NOTE };
      if (s.type === "faq") return { ...s, items: s.items.slice(0, FAQ_MAX) };
      return s;
    })
    .sort((a, b) => rank(a.type) - rank(b.type));
  if (!sections.some((s) => s.type === "social_proof")) {
    const at = sections.findIndex((s) => rank(s.type) > rank("social_proof"));
    sections.splice(at === -1 ? sections.length : at, 0, {
      type: "social_proof",
      heading: "What customers say",
      placeholderNote: SOCIAL_PROOF_NOTE,
    });
  }

  const byHandle = new Map(raw.pages.map((p) => [p.handle, p]));
  const pages: StorePage[] = REQUIRED_PAGES.flatMap((r) => {
    const p = byHandle.get(r.handle);
    return p ? [{ ...p, handle: r.handle, kind: r.kind, title: p.title.trim() || r.title }] : [];
  });
  const required = new Set(REQUIRED_PAGES.map((r) => r.handle));
  pages.push(...raw.pages.filter((p) => !required.has(p.handle)));

  const seen = new Set<string>(["all"]);
  const extra = raw.collections
    .filter((c) => c.handle !== "all")
    .map((c) => ({ ...c, handle: toHandle(c.handle || c.title) }))
    .filter((c) => (seen.has(c.handle) ? false : (seen.add(c.handle), true)))
    .slice(0, 2);
  const all = raw.collections.find((c) => c.handle === "all");
  const collections = [{ ...ALL_COLLECTION, ...all, handle: "all", rules: null }, ...extra];

  return {
    ...raw,
    announcementBar: truncateAtWord(raw.announcementBar, ANNOUNCEMENT_MAX),
    homepageSections: sections,
    pages,
    collections,
    menus: buildMenus(pages, collections),
    settings: {
      ...raw.settings,
      storeName: raw.settings.storeName.trim() || opts.storeName,
      currency: opts.currency,
      tagline: raw.settings.tagline.trim() || opts.tagline,
    },
  };
}

function rank(type: HomepageSection["type"]) {
  const i = SECTION_ORDER.indexOf(type);
  return i === -1 ? SECTION_ORDER.length : i;
}
