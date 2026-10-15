import "server-only";
import { z } from "zod";
import {
  BADGE_ICONS,
  BENEFIT_ICONS,
  FAQ_MAX,
  FAQ_MIN,
  REQUIRED_PAGES,
} from "@/lib/content/structure";
import type { ProjectRecord } from "@/lib/db/projects";
import { describeViolations, findViolationsDeep } from "@/lib/guardrails";
import { CollectionRule, Handle } from "@/lib/schemas";
import { formatMoney } from "@/lib/utils";
import { productFacts, styleOf } from "./context";
import { fixtureContent } from "./fixtures/content";
import { forbiddenBrands } from "./listing";
import { CONTENT_SYSTEM } from "./prompts/content";
import { globalRules } from "./prompts/global";
import { callStructured } from "./structured";

const Faq = z.object({ question: z.string().min(3), answer: z.string().min(3) });

/** What the model writes. Menus, settings and the review placeholder wording are built in code. */
export const ContentSection = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    headline: z.string().min(2).max(80),
    subheadline: z.string().min(2).max(200),
    ctaLabel: z.string().min(2).max(30),
    ctaLink: z.string(),
  }),
  z.object({ type: z.literal("featured_product"), heading: z.string().min(2).max(80) }),
  z.object({
    type: z.literal("benefits"),
    heading: z.string().min(2).max(80),
    items: z
      .array(
        z.object({
          icon: z.enum(BENEFIT_ICONS),
          title: z.string().min(2).max(60),
          text: z.string().min(2).max(200),
        }),
      )
      .min(2)
      .max(6),
  }),
  z.object({ type: z.literal("social_proof"), heading: z.string().min(2).max(80) }),
  z.object({ type: z.literal("faq"), heading: z.string().min(2).max(80), items: z.array(Faq) }),
  z.object({
    type: z.literal("trust_badges"),
    heading: z.string().min(2).max(80),
    badges: z
      .array(z.object({ icon: z.enum(BADGE_ICONS), label: z.string().min(2).max(60) }))
      .min(2)
      .max(6),
  }),
  z.object({
    type: z.literal("newsletter"),
    heading: z.string().min(2).max(80),
    text: z.string().min(2).max(240),
  }),
]);

export const ContentOutput = z.object({
  announcementBar: z.string().min(3).max(120),
  homepageSections: z.array(ContentSection).min(5),
  pages: z.array(
    z.object({
      handle: z.string().min(1),
      title: z.string().min(2).max(80),
      kind: z.enum(["about", "contact", "faq", "policy"]),
      bodyHtml: z.string().min(20),
    }),
  ),
  collections: z
    .array(
      z.object({
        handle: Handle,
        title: z.string().min(2).max(80),
        descriptionHtml: z.string(),
        rules: z.object({
          appliedDisjunctively: z.boolean(),
          rules: z.array(CollectionRule).min(1).max(5),
        }),
      }),
    )
    .min(1)
    .max(2),
  checkoutNotes: z.array(z.string().min(3).max(200)).min(1).max(4),
});
export type ContentOutput = z.infer<typeof ContentOutput>;

const LEGAL_NOTICE_RE =
  /not\s+(?:legal|professional)\s+advice|consult\s+(?:a|an|your)\s+(?:lawyer|attorney|counsel)/i;

/** Problems the model must fix before its content is accepted (each fed back on retry). */
export function contentProblems(v: ContentOutput, brands: string[]): string[] {
  const problems: string[] = [];
  const types = v.homepageSections.map((s) => s.type);
  for (const t of [
    "hero",
    "featured_product",
    "benefits",
    "social_proof",
    "faq",
    "trust_badges",
    "newsletter",
  ] as const) {
    if (!types.includes(t)) problems.push(`- homepageSections: add the ${t} section`);
  }
  const faq = v.homepageSections.find((s) => s.type === "faq");
  if (faq && faq.type === "faq" && (faq.items.length < FAQ_MIN || faq.items.length > FAQ_MAX))
    problems.push(
      `- homepageSections.faq: write ${FAQ_MIN}–${FAQ_MAX} questions (you wrote ${faq.items.length})`,
    );
  const handles = new Set(v.pages.map((p) => p.handle));
  const missing = REQUIRED_PAGES.filter((r) => !handles.has(r.handle));
  if (missing.length)
    problems.push(
      `- pages: add pages with handles ${missing.map((m) => `"${m.handle}"`).join(", ")}`,
    );
  for (const p of v.pages) {
    if (LEGAL_NOTICE_RE.test(p.bodyHtml))
      problems.push(
        `- pages.${p.handle}: remove the "not legal advice" text; the app shows that notice to the merchant`,
      );
  }
  if (v.collections.some((c) => c.handle === "all"))
    problems.push('- collections: leave out "all"; the app adds the All Products collection');
  const text = JSON.stringify(v).toLowerCase();
  const hits = brands.filter((b) =>
    new RegExp(`\\b${b.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text),
  );
  if (hits.length)
    problems.push(`- remove other companies' brand names from the store copy (${hits.join(", ")})`);
  const g = findViolationsDeep({
    announcementBar: v.announcementBar,
    homepageSections: v.homepageSections,
    pages: v.pages,
    collections: v.collections,
  });
  if (g.length) problems.push(describeViolations(g));
  return problems;
}

/** Homepage, pages, policies and collections for the store. */
export async function generateStoreContent(
  project: ProjectRecord,
  opts: { instruction?: string } = {},
): Promise<ContentOutput> {
  const kit = project.brandKit;
  const listing = project.listing;
  const brands = forbiddenBrands(project);
  const price = listing?.variants[0]?.price;
  const voice = kit?.voice;
  return callStructured({
    task: "generateStoreContent",
    projectId: project.id,
    system: `${CONTENT_SYSTEM}\n\n${globalRules(styleOf(project))}`,
    content: [
      {
        type: "text",
        text: [
          productFacts(project, { includeAnalysis: true }),
          `Store brand: ${kit?.selectedName ?? "[BUSINESS NAME]"}`,
          kit?.tagline ? `Tagline: ${kit.tagline}` : "",
          voice
            ? `Brand voice: ${voice.adjectives.join(", ")}\nDo: ${voice.do.join("; ")}\nDon't: ${voice.dont.join("; ")}`
            : "",
          listing
            ? [
                `Product title: ${listing.title}`,
                `Product handle: ${listing.handle}`,
                `Product type: ${listing.productType}`,
                `Tags: ${listing.tags.join(", ")}`,
                price ? `Price: ${formatMoney(price, project.inputs.context.currency)}` : "",
              ]
                .filter(Boolean)
                .join("\n")
            : "",
          opts.instruction ? `Merchant instruction: ${opts.instruction}` : "",
          "Write the store content.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: ContentOutput,
    toolName: "record_store_content",
    toolDescription: "Record the homepage sections, pages, collections and checkout notes.",
    maxTokens: 16000,
    effort: "medium",
    check: (v) => contentProblems(v, brands),
    fixture: () => fixtureContent(project),
  });
}
