import { z } from "zod";
import { Handle } from "./common";

export const HomepageSection = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    headline: z.string(),
    subheadline: z.string(),
    ctaLabel: z.string(),
    ctaLink: z.string(),
  }),
  z.object({
    type: z.literal("featured_product"),
    heading: z.string(),
  }),
  z.object({
    type: z.literal("benefits"),
    heading: z.string(),
    items: z
      .array(z.object({ icon: z.string(), title: z.string(), text: z.string() }))
      .min(2)
      .max(6),
  }),
  z.object({
    type: z.literal("social_proof"),
    heading: z.string(),
    /** Always a placeholder: StoreForge never generates reviews or testimonials. */
    placeholderNote: z.string(),
  }),
  z.object({
    type: z.literal("faq"),
    heading: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })).min(1),
  }),
  z.object({
    type: z.literal("newsletter"),
    heading: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("trust_badges"),
    heading: z.string(),
    badges: z
      .array(z.object({ icon: z.string(), label: z.string() }))
      .min(2)
      .max(6),
  }),
  z.object({
    type: z.literal("rich_text"),
    heading: z.string(),
    text: z.string(),
  }),
]);
export type HomepageSection = z.infer<typeof HomepageSection>;

export const StorePage = z.object({
  handle: Handle,
  title: z.string(),
  bodyHtml: z.string(),
  kind: z.enum(["about", "contact", "faq", "policy"]),
});
export type StorePage = z.infer<typeof StorePage>;

export const CollectionRule = z.object({
  column: z.enum(["TAG", "TITLE", "TYPE", "VENDOR", "VARIANT_PRICE"]),
  relation: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "CONTAINS",
    "STARTS_WITH",
    "GREATER_THAN",
    "LESS_THAN",
  ]),
  condition: z.string(),
});
export type CollectionRule = z.infer<typeof CollectionRule>;

export const StoreCollection = z.object({
  handle: Handle,
  title: z.string(),
  descriptionHtml: z.string(),
  rules: z
    .object({ appliedDisjunctively: z.boolean(), rules: z.array(CollectionRule).min(1) })
    .nullable()
    .default(null),
});
export type StoreCollection = z.infer<typeof StoreCollection>;

export const MenuItem = z.object({
  title: z.string(),
  url: z.string(),
  type: z.enum([
    "FRONTPAGE",
    "COLLECTION",
    "COLLECTIONS",
    "PRODUCT",
    "PAGE",
    "SHOP_POLICY",
    "HTTP",
    "SEARCH",
    "CATALOG",
  ]),
  handle: z.string().nullable().default(null),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const StoreSettings = z.object({
  storeName: z.string(),
  currency: z.string(),
  tagline: z.string(),
  socialLinks: z.object({
    instagram: z.string(),
    facebook: z.string(),
    tiktok: z.string(),
    pinterest: z.string(),
    youtube: z.string(),
  }),
  checkoutNotes: z.array(z.string()),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

export const StoreContent = z.object({
  announcementBar: z.string().max(120),
  homepageSections: z.array(HomepageSection).min(1),
  pages: z.array(StorePage),
  collections: z.array(StoreCollection).min(1).max(3),
  menus: z.object({ main: z.array(MenuItem), footer: z.array(MenuItem) }),
  settings: StoreSettings,
  placeholdersAcknowledged: z.boolean().default(false),
});
export type StoreContent = z.infer<typeof StoreContent>;
