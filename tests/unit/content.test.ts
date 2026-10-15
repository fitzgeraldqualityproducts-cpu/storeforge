import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/config";
import {
  fillPlaceholder,
  findPlaceholders,
  normalizeContent,
  placeholderSummary,
  REQUIRED_PAGES,
  SOCIAL_PROOF_NOTE,
} from "@/lib/content/structure";
import { getProject } from "@/lib/db/projects";
import { findViolationsDeep } from "@/lib/guardrails";
import type { JobContext } from "@/lib/jobs/runner";
import { StoreContent } from "@/lib/schemas";
import { dripperProject } from "../support/dripper";

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

import { fixtureContent } from "@/lib/ai/fixtures/content";
import { runContent } from "@/lib/pipeline/content";
import { runListing } from "@/lib/pipeline/listing";
import { runRegenerate } from "@/lib/pipeline/regenerate";

const ctxFor = (projectId: string, payload: Record<string, unknown> = {}): JobContext => ({
  jobId: "t",
  projectId,
  type: "content",
  payload,
  progress: async () => undefined,
});

describe("store content (fixture mode)", () => {
  it("builds every page, a code-built menu and no fabricated social proof", async () => {
    const p = await dripperProject("Content");
    const res = await runContent(ctxFor(p.id));
    const project = await getProject(p.id);
    const c = StoreContent.parse(project.content);

    // Prerequisites ran automatically.
    expect(project.listing).not.toBeNull();
    expect(res.pages).toBe(REQUIRED_PAGES.length);
    expect(c.pages.map((x) => x.handle)).toEqual(REQUIRED_PAGES.map((r) => r.handle));
    expect(c.homepageSections.map((s) => s.type)).toEqual([
      "hero",
      "featured_product",
      "benefits",
      "social_proof",
      "faq",
      "trust_badges",
      "newsletter",
    ]);
    const hero = c.homepageSections.find((s) => s.type === "hero");
    expect(hero?.type === "hero" && hero.ctaLink).toBe(`/products/${project.listing!.handle}`);
    const proof = c.homepageSections.find((s) => s.type === "social_proof");
    expect(proof?.type === "social_proof" && proof.placeholderNote).toBe(SOCIAL_PROOF_NOTE);
    const faq = c.homepageSections.find((s) => s.type === "faq");
    expect(faq?.type === "faq" && faq.items.length).toBeGreaterThanOrEqual(8);
    expect(faq?.type === "faq" && faq.items.length).toBeLessThanOrEqual(10);

    expect(c.collections[0]).toMatchObject({ handle: "all", title: "All Products", rules: null });
    expect(c.collections.length).toBeGreaterThanOrEqual(2);
    expect(c.collections.slice(1).every((x) => x.rules && x.rules.rules.length > 0)).toBe(true);

    expect(c.menus.main[0]).toMatchObject({ url: "/", type: "FRONTPAGE" });
    expect(c.menus.main.find((m) => m.title === "Shop")).toMatchObject({
      url: "/collections/all",
      type: "COLLECTION",
    });
    expect(c.menus.footer.filter((m) => m.type === "SHOP_POLICY").map((m) => m.url)).toEqual([
      "/policies/shipping-policy",
      "/policies/refund-policy",
      "/policies/privacy-policy",
      "/policies/terms-of-service",
    ]);
    expect(c.settings.storeName).toBe(project.brandKit!.selectedName);
    expect(c.announcementBar.length).toBeLessThanOrEqual(80);

    // Policies are templates with placeholders; no legal disclaimer inside page text.
    const policies = c.pages.filter((x) => x.kind === "policy");
    expect(policies.every((x) => /\[[A-Z ]+\]/.test(x.bodyHtml))).toBe(true);
    expect(c.pages.every((x) => !/legal advice/i.test(x.bodyHtml))).toBe(true);
    expect(c.pages.every((x) => !/<(script|div|img|span)/i.test(x.bodyHtml))).toBe(true);
    expect(findViolationsDeep(c)).toEqual([]);
    expect(JSON.stringify(c).toLowerCase()).not.toContain("kilnworks");
    expect(c.placeholdersAcknowledged).toBe(false);
    expect(project.steps.content.status).toBe("ready");
  });

  it("finds and fills placeholders everywhere, escaping HTML in page bodies", async () => {
    const p = await dripperProject("Placeholders");
    await runContent(ctxFor(p.id));
    const c = (await getProject(p.id)).content!;
    const summary = placeholderSummary(c);
    const email = summary.find((s) => s.token === "[SUPPORT EMAIL]");
    expect(email && email.count).toBeGreaterThan(2);
    // The review placeholder is intentional and not reported.
    expect(findPlaceholders(c).some((h) => h.where.includes("Reviews"))).toBe(false);

    const filled = fillPlaceholder(c, "[SUPPORT EMAIL]", "<help@example.com>");
    expect(JSON.stringify(filled)).not.toContain("[SUPPORT EMAIL]");
    const contact = filled.pages.find((x) => x.handle === "contact")!;
    expect(contact.bodyHtml).toContain("&lt;help@example.com&gt;");
    expect(contact.bodyHtml).not.toContain("<help@example.com>");
  });

  it("keeps placeholders when a page is shortened", async () => {
    const p = await dripperProject("Rewrite page");
    await runContent(ctxFor(p.id));
    const before = (await getProject(p.id)).content!.pages.find((x) => x.handle === "about-us")!;
    await runRegenerate(
      ctxFor(p.id, { section: "content_page", field: "pages.about-us", operation: "shorten" }),
    );
    const after = (await getProject(p.id)).content!.pages.find((x) => x.handle === "about-us")!;
    expect(after.bodyHtml.length).toBeLessThan(before.bodyHtml.length);
    expect(after.bodyHtml).toContain("[FOUNDER NAME]");
  });

  it("normalizes edits: menus rebuilt, review placeholder restored, sections ordered", async () => {
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const p = await dripperProject("Edit content");
    await runContent(ctxFor(p.id));
    const c = (await getProject(p.id)).content!;
    const edited: StoreContent = {
      ...c,
      homepageSections: [...c.homepageSections]
        .reverse()
        .map((s) =>
          s.type === "social_proof" ? { ...s, placeholderNote: "★★★★★ Best ever — Jane D." } : s,
        ),
      pages: c.pages.map((x) =>
        x.handle === "faq" ? { ...x, bodyHtml: `${x.bodyHtml}<script>alert(1)</script>` } : x,
      ),
      menus: { main: [], footer: [] },
    };
    const res = await PATCH(
      new Request(`http://localhost/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: edited }),
      }),
      { params: Promise.resolve({ id: p.id }) },
    );
    expect(res.status).toBe(200);
    const after = (await getProject(p.id)).content!;
    expect(after.homepageSections[0]!.type).toBe("hero");
    const proof = after.homepageSections.find((s) => s.type === "social_proof");
    expect(proof?.type === "social_proof" && proof.placeholderNote).toBe(SOCIAL_PROOF_NOTE);
    expect(after.pages.find((x) => x.handle === "faq")!.bodyHtml).not.toContain("<script");
    expect(after.menus.main.length).toBeGreaterThan(3);
  });

  it("normalizes content without a product or social-proof section", () => {
    const base = fixtureContent({
      id: "x",
      name: "x",
      inputs: { urls: [], context: {} },
      extractions: [],
      analysis: null,
      brandKit: null,
      listing: null,
    } as never);
    const raw: StoreContent = {
      ...base,
      homepageSections: base.homepageSections.filter(
        (s) => s.type !== "social_proof",
      ) as StoreContent["homepageSections"],
      collections: [{ handle: "all", title: "All Products", descriptionHtml: "", rules: null }],
      menus: { main: [], footer: [] },
      settings: {
        storeName: "",
        currency: "USD",
        tagline: "",
        socialLinks: { instagram: "", facebook: "", tiktok: "", pinterest: "", youtube: "" },
        checkoutNotes: [],
      },
      placeholdersAcknowledged: false,
    };
    const n = normalizeContent(raw, {
      productHandle: null,
      storeName: "Shop",
      currency: "EUR",
      tagline: "",
    });
    const types = n.homepageSections.map((s) => s.type);
    expect(types.indexOf("social_proof")).toBe(types.indexOf("faq") - 1);
    const hero = n.homepageSections.find((s) => s.type === "hero");
    expect(hero?.type === "hero" && hero.ctaLink).toBe("/collections/all");
    expect(n.settings).toMatchObject({ storeName: "Shop", currency: "EUR" });
  });
});

describe("store content (live path with a scripted client)", () => {
  const tool = (name: string, input: unknown) => ({
    role: "assistant",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "tool_use", id: `tu_${Math.random()}`, name, input }],
  });
  beforeEach(() => {
    fake.queue.length = 0;
    fake.requests.length = 0;
  });
  afterEach(() => {
    process.env.AI_MODE = "fixture";
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvCache();
  });

  it("sends fake reviews, missing pages and short FAQs back to the model", async () => {
    const p = await dripperProject("Live content");
    await runListing(ctxFor(p.id)); // fixture mode for prerequisites
    process.env.AI_MODE = "live";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    resetEnvCache();
    const project = await getProject(p.id);
    const good = fixtureContent(project);
    const bad = {
      ...good,
      announcementBar: "Selling fast: only 3 left!",
      homepageSections: good.homepageSections.map((s) =>
        s.type === "faq" ? { ...s, items: s.items.slice(0, 4) } : s,
      ),
      pages: good.pages
        .filter((x) => x.handle !== "privacy-policy")
        .map((x) =>
          x.handle === "terms-of-service"
            ? { ...x, bodyHtml: `${x.bodyHtml}<p>This is not legal advice.</p>` }
            : x,
        ),
    };
    fake.queue.push(tool("record_store_content", bad), tool("record_store_content", good));
    await runContent(ctxFor(p.id));
    expect(fake.requests).toHaveLength(2);
    const feedback = JSON.stringify(fake.requests[1]!.messages);
    expect(feedback).toMatch(/only 3 left/i);
    expect(feedback).toMatch(/privacy-policy/);
    expect(feedback).toMatch(/8–10 questions/);
    expect(feedback).toMatch(/not legal advice/);
    const saved = (await getProject(p.id)).content!;
    expect(saved.pages.map((x) => x.handle)).toContain("privacy-policy");
  });
});
