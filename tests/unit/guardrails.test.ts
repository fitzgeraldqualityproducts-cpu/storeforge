import { describe, expect, it } from "vitest";
import { detectSourceRisks, findGuardrailViolations } from "@/lib/guardrails";

const rules = (t: string) => findGuardrailViolations(t).map((v) => v.rule);

describe("guardrails", () => {
  it("flags fabricated social proof, urgency, medical claims and supplier mentions", () => {
    expect(rules("★★★★★ Loved by 10,000+ customers")).toContain("fake_review");
    expect(rules("Rated 4.8 out of 5 stars")).toContain("fake_review");
    expect(rules('"Best purchase I ever made" — Sarah K.')).toContain("fake_review");
    expect(rules("Only 3 left in stock! Hurry")).toContain("fake_urgency");
    expect(rules("Offer ends tonight")).toContain("fake_urgency");
    expect(rules("Clinically proven to relieve back pain")).toContain("medical_claim");
    expect(rules("This pillow cures insomnia")).toContain("medical_claim");
    expect(rules("Our #1 best-selling dripper")).toContain("unverified_superlative");
    expect(rules("We are # 1 for pour-over")).toContain("unverified_superlative");
    expect(rules("## 1. Import the product")).not.toContain("unverified_superlative");
    expect(rules("As seen on TV")).toContain("fake_credential");
    expect(rules("Ships from our AliExpress partner")).toContain("supplier_mention");
  });

  it("does not flag ordinary product copy", () => {
    const ok = [
      "Thick stoneware walls hold heat through the whole brew.",
      "Dog treats made with real chicken.",
      "The resin cures in 24 hours at room temperature.",
      "Add real reviews here once customers start buying.",
      "Free shipping on orders over [AMOUNT].",
      "Hand wash recommended. Not suitable for the microwave.",
      "Reduces drips on the counter thanks to the wide base.",
    ];
    for (const t of ok) expect(rules(t), t).toEqual([]);
  });

  it("detects source risks: trademarks, claims, restricted categories", () => {
    const flags = detectSourceRisks(
      "Our #1 best-selling dripper. Compatible with Hario V60 filters. Includes a 2000mAh rechargeable battery.",
    );
    const cats = flags.map((f) => f.category);
    expect(cats).toContain("trademark");
    expect(cats).toContain("claims");
    expect(cats).toContain("battery_shipping");
    expect(
      detectSourceRisks("Replica AAA quality Rolex watch").some(
        (f) => f.category === "counterfeit" && f.severity === "block",
      ),
    ).toBe(true);
    expect(
      detectSourceRisks("Relieves arthritis pain fast").some(
        (f) => f.category === "medical" && f.severity === "block",
      ),
    ).toBe(true);
    expect(detectSourceRisks("A ceramic mug for coffee.")).toEqual([]);
  });
});

describe("generated output lint", () => {
  /**
   * Spec acceptance: no fabricated reviews, urgency or medical claims in any generated output.
   * Runs the whole fixture pipeline (URL and photos-only), builds the bundle, and lints every
   * text file in the ZIP plus the stored listing, brand kit and store content.
   */
  it("finds no guardrail violations in anything StoreForge generates", async () => {
    const { default: AdmZip } = await import("adm-zip");
    const { prisma } = await import("@/lib/db/client");
    const { createProject, getProject } = await import("@/lib/db/projects");
    const { runExportBundle } = await import("@/lib/export/bundle");
    const { ingestImage } = await import("@/lib/images/ingest");
    const { runContent } = await import("@/lib/pipeline/content");
    const { findViolationsDeep } = await import("@/lib/guardrails");
    const { fromDataRelative } = await import("@/lib/security/paths");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { dripperProject } = await import("../support/dripper");

    const ctx = (projectId: string, payload: Record<string, unknown> = {}) => ({
      jobId: "t",
      projectId,
      type: "content" as const,
      payload,
      progress: async () => undefined,
    });
    const fromUrl = await dripperProject("Lint (URL)");
    const photosOnly = await createProject("Lint (photos)");
    for (const n of [1, 2, 3]) {
      await ingestImage(
        photosOnly.id,
        readFileSync(path.join(__dirname, `../fixtures/site/images/dripper-${n}.jpg`)),
        { origin: "upload" },
      );
    }

    const problems: string[] = [];
    for (const p of [fromUrl, photosOnly]) {
      await runContent(ctx(p.id));
      const project = await getProject(p.id);
      for (const [name, value] of Object.entries({
        listing: project.listing,
        brandKit: project.brandKit,
        content: project.content,
      })) {
        expect(value, name).not.toBeNull();
        for (const v of findViolationsDeep(value, name))
          problems.push(`${p.name} ${v.path}: ${v.rule} "${v.match}"`);
      }
      const res = await runExportBundle(
        ctx(p.id, { imageMode: "upload_after", csvFormat: "current" }),
      );
      const row = await prisma.exportRecord.findUniqueOrThrow({ where: { id: res.exportId } });
      const zip = new AdmZip(fromDataRelative(row.artifactPath!));
      for (const e of zip.getEntries()) {
        if (!/\.(md|html|csv|json)$/.test(e.entryName)) continue;
        for (const v of findViolationsDeep(zip.readAsText(e), e.entryName)) {
          problems.push(`${p.name} ${v.path}: ${v.rule} "${v.match}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
