import "server-only";
import { generateStoreContent, type ContentOutput } from "@/lib/ai/content";
import { fixtureContent } from "@/lib/ai/fixtures/content";
import { rewriteField } from "@/lib/ai/rewrite";
import {
  ANNOUNCEMENT_MAX,
  normalizeContent,
  PLACEHOLDER_RE,
  REQUIRED_PAGES,
  SOCIAL_PROOF_NOTE,
} from "@/lib/content/structure";
import { getProject, updateProject, type ProjectRecord } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { sanitizePageHtml } from "@/lib/html/sanitize";
import type { JobContext } from "@/lib/jobs/runner";
import { StoreContent, type HomepageSection, type RegenerateRequest } from "@/lib/schemas";
import { runAnalyze } from "./analyze";
import { runBrand } from "./brand";
import { runListing } from "./listing";

type Range = [number, number];
const span =
  (range: Range = [0, 100]) =>
  (f: number) =>
    range[0] + (range[1] - range[0]) * f;

const EMPTY_SOCIALS = { instagram: "", facebook: "", tiktok: "", pinterest: "", youtube: "" };

/** Sanitize page/collection HTML and put content into canonical shape (server side). */
export function finalizeContent(project: ProjectRecord, content: StoreContent): StoreContent {
  const kit = project.brandKit;
  const sanitized: StoreContent = {
    ...content,
    pages: content.pages.map((p) => ({ ...p, bodyHtml: sanitizePageHtml(p.bodyHtml) })),
    collections: content.collections.map((c) => ({
      ...c,
      descriptionHtml: sanitizePageHtml(c.descriptionHtml),
    })),
  };
  return StoreContent.parse(
    normalizeContent(sanitized, {
      productHandle: project.listing?.handle ?? null,
      storeName: kit?.selectedName || project.inputs.context.brandName || project.name,
      currency: project.inputs.context.currency,
      tagline: kit?.tagline ?? "",
    }),
  );
}

/** Turn the model's output into StoreContent, keeping the merchant's settings edits. */
export function assembleContent(project: ProjectRecord, out: ContentOutput): StoreContent {
  const prev = project.content;
  const sections = out.homepageSections.map((s): HomepageSection =>
    s.type === "social_proof" ? { ...s, placeholderNote: SOCIAL_PROOF_NOTE } : s,
  );
  return finalizeContent(project, {
    announcementBar: out.announcementBar,
    homepageSections: sections,
    pages: out.pages.map((p) => {
      const req = REQUIRED_PAGES.find((r) => r.handle === p.handle);
      return { ...p, kind: req?.kind ?? p.kind };
    }),
    collections: [
      { handle: "all", title: "All Products", descriptionHtml: "", rules: null },
      ...out.collections,
    ],
    menus: { main: [], footer: [] },
    settings: {
      storeName: prev?.settings.storeName ?? "",
      currency: project.inputs.context.currency,
      tagline: prev?.settings.tagline ?? "",
      socialLinks: prev?.settings.socialLinks ?? EMPTY_SOCIALS,
      checkoutNotes: out.checkoutNotes,
    },
    placeholdersAcknowledged: false,
  });
}

async function ensurePrereqs(ctx: JobContext, at: (f: number) => number) {
  let project = await getProject(ctx.projectId);
  if (!project.analysis) {
    await runAnalyze(ctx, { range: [at(0), at(0.1)] });
    project = await getProject(ctx.projectId);
  }
  if (!project.brandKit?.selectedName) {
    await runBrand(ctx, { range: [at(0.1), at(0.2)] });
    project = await getProject(ctx.projectId);
  }
  if (!project.listing) {
    await runListing(ctx, { range: [at(0.2), at(0.4)] });
    project = await getProject(ctx.projectId);
  }
  return project;
}

/** Step 6: homepage sections, pages, policies, collections, menus and settings. */
export async function runContent(
  ctx: JobContext,
  opts: { range?: Range; instruction?: string } = {},
) {
  const at = span(opts.range);
  const project = await ensurePrereqs(ctx, at);
  await ctx.progress("content", at(0.45), "Writing the homepage, pages and policies");
  const out = await generateStoreContent(project, { instruction: opts.instruction });
  await ctx.progress("content", at(0.9), "Building collections and menus");
  const content = assembleContent(project, out);
  await updateProject(ctx.projectId, {
    content,
    changed: ["content"],
    steps: { content: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  await ctx.progress("content", at(1), "Store content ready");
  return {
    sections: content.homepageSections.length,
    pages: content.pages.length,
    collections: content.collections.length,
  };
}

/** Every bracketed placeholder, so rewrites can be told to keep them. */
function placeholders(text: string) {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[0]))];
}

/**
 * Field-level rewrite for store content: `pages.<handle>`, `announcementBar`,
 * `hero.headline` or `hero.subheadline`.
 */
export async function rewriteContentField(ctx: JobContext, req: RegenerateRequest) {
  const project = await getProject(ctx.projectId);
  const content = project.content;
  if (!content) throw new UserFacingError("Generate the store content first.");
  const field = req.field ?? "";
  const operation = req.operation ?? "regenerate";
  const fixture = fixtureContent(project);

  let label: string;
  let current: string;
  let html = false;
  let maxLength: number | undefined;
  let fixtureValue: string;
  let apply: (v: string) => StoreContent;

  const hero = content.homepageSections.find((s) => s.type === "hero");
  const fixtureHero = fixture.homepageSections.find((s) => s.type === "hero");
  if (field.startsWith("pages.")) {
    const handle = field.slice("pages.".length);
    const page = content.pages.find((p) => p.handle === handle);
    if (!page) throw new UserFacingError(`There's no page "${handle}".`);
    label = `${page.title} page`;
    current = page.bodyHtml;
    html = true;
    fixtureValue = fixture.pages.find((p) => p.handle === handle)?.bodyHtml ?? page.bodyHtml;
    apply = (v) => ({
      ...content,
      pages: content.pages.map((p) => (p.handle === handle ? { ...p, bodyHtml: v } : p)),
    });
  } else if (field === "announcementBar") {
    label = "Announcement bar";
    current = content.announcementBar;
    maxLength = ANNOUNCEMENT_MAX;
    fixtureValue = fixture.announcementBar;
    apply = (v) => ({ ...content, announcementBar: v });
  } else if ((field === "hero.headline" || field === "hero.subheadline") && hero?.type === "hero") {
    const key = field === "hero.headline" ? "headline" : "subheadline";
    label = key === "headline" ? "Homepage headline" : "Homepage subheadline";
    current = hero[key];
    maxLength = key === "headline" ? 80 : 200;
    fixtureValue = fixtureHero?.type === "hero" ? fixtureHero[key] : current;
    apply = (v) => ({
      ...content,
      homepageSections: content.homepageSections.map((s) =>
        s.type === "hero" ? { ...s, [key]: v } : s,
      ),
    });
  } else {
    throw new UserFacingError(`"${field}" can't be rewritten.`);
  }

  const keep = placeholders(current);
  await ctx.progress(
    "content",
    20,
    `${operation === "shorten" ? "Shortening" : operation === "change_tone" ? "Changing the tone of" : "Rewriting"} the ${label.toLowerCase()}`,
  );
  const value = await rewriteField({
    project,
    label,
    current,
    operation,
    html,
    tone: req.tone,
    instruction: [
      req.instruction,
      keep.length
        ? `Keep these placeholders exactly as written so the merchant can fill them: ${keep.join(", ")}.`
        : "",
      html ? "Do not add any 'not legal advice' text; the app shows that notice separately." : "",
    ]
      .filter(Boolean)
      .join(" "),
    maxLength,
    check: (v) => {
      const dropped = keep.filter((k) => !v.includes(k));
      return dropped.length ? [`- value: keep the placeholders ${dropped.join(", ")}`] : [];
    },
    fixture: () => fixtureValue,
  });
  const next = finalizeContent(project, apply(value));
  await updateProject(ctx.projectId, {
    content: next,
    changed: ["content"],
    steps: { content: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
  });
  return { field, operation, length: value.length };
}
