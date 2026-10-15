import { describe, expect, it } from "vitest";
import { listAssets } from "@/lib/db/assets";
import { projectPreflight } from "@/lib/db/preflight";
import { getProject, updateProject } from "@/lib/db/projects";
import { nextSteps } from "@/lib/export/next-steps";
import { runPreflight, type Preflight } from "@/lib/export/preflight";
import type { JobContext } from "@/lib/jobs/runner";
import { runContent } from "@/lib/pipeline/content";
import { dripperProject } from "../support/dripper";

const ctxFor = (projectId: string): JobContext => ({
  jobId: "t",
  projectId,
  type: "content",
  payload: {},
  progress: async () => undefined,
});

const item = (pf: Preflight, id: string) => pf.items.find((i) => i.id === id)!;

describe("pre-flight checklist", () => {
  it("covers every item the spec lists and passes for a finished fixture store", async () => {
    const p = await dripperProject("Preflight");
    await runContent(ctxFor(p.id));
    let project = await getProject(p.id);
    const pf = await projectPreflight(project, await listAssets(p.id));
    expect(pf.items.map((i) => i.id)).toEqual([
      "required",
      "images",
      "alt",
      "seo",
      "contrast",
      "risk",
      "placeholders",
      "margin",
      "variants",
      "handle",
      "confirm",
    ]);
    for (const id of [
      "required",
      "images",
      "alt",
      "seo",
      "contrast",
      "risk",
      "variants",
      "handle",
    ]) {
      expect(item(pf, id).status, `${id}: ${item(pf, id).detail}`).toBe("pass");
    }
    // The fixture policies still have [PLACEHOLDERS]: they block until filled or acknowledged.
    expect(item(pf, "placeholders").status).toBe("fail");
    expect(pf.ok).toBe(false);

    project = await updateProject(p.id, {
      content: { ...project.content!, placeholdersAcknowledged: true },
    });
    const acknowledged = await projectPreflight(project, await listAssets(p.id));
    expect(item(acknowledged, "placeholders").status).toBe("pass");
    expect(acknowledged.ok).toBe(true);

    // A second project with the same product handle gets a warning, not a failure.
    const other = await dripperProject("Preflight twin");
    await runContent(ctxFor(other.id));
    const twin = await projectPreflight(await getProject(other.id), await listAssets(other.id));
    expect(item(twin, "handle").status).toBe("warn");
  });

  it("fails on too few images, missing alt text, price at or below cost, blocking flags and a bad variant matrix", async () => {
    const p = await dripperProject("Preflight fails");
    await runContent(ctxFor(p.id));
    const project = await getProject(p.id);
    const assets = (await listAssets(p.id)).filter((a) => !a.discarded);
    const listing = project.listing!;
    const pf = runPreflight({
      listing: {
        ...listing,
        seoTitle: "x".repeat(70),
        variants: [
          { ...listing.variants[0]!, costPerItem: listing.variants[0]!.price },
          { ...listing.variants[0]! },
        ],
      },
      content: { ...project.content!, placeholdersAcknowledged: true },
      brand: {
        ...project.brandKit!,
        palette: { ...project.brandKit!.palette!, text: "#ffffff", background: "#fefefe" },
      },
      analysis: {
        ...project.analysis!,
        riskFlags: [
          {
            id: "r1",
            severity: "block",
            category: "medical",
            message: "Claims to cure insomnia",
            suggestedFix: "Remove the claim",
            acknowledged: false,
            source: "rules",
          },
        ],
      },
      assets: [{ ...assets[0]!, altText: "" }, assets[1]!],
    });
    expect(item(pf, "images")).toMatchObject({ status: "fail", step: "images" });
    expect(item(pf, "alt").detail).toMatch(/1 image without alt text/);
    expect(item(pf, "seo").detail).toMatch(/SEO title is 70\/60/);
    expect(item(pf, "contrast").status).toBe("fail");
    expect(item(pf, "risk").detail).toMatch(/Claims to cure insomnia/);
    expect(item(pf, "margin").status).toBe("fail");
    expect(item(pf, "variants").detail).toMatch(/more than once/);
    expect(pf.failed).toBe(7);
  });
});

describe("next steps in Shopify", () => {
  it("covers theme, domain, payments, shipping, taxes, legal review, test order and password for both paths", () => {
    for (const path of ["bundle", "push"] as const) {
      const titles = nextSteps(path, { themePushed: false })
        .map((s) => `${s.title} ${s.body}`)
        .join("\n");
      for (const topic of [
        /theme/i,
        /domain/i,
        /payments/i,
        /shipping/i,
        /tax/i,
        /lawyer/i,
        /test order/i,
        /password/i,
      ]) {
        expect(titles, `${path} ${topic}`).toMatch(topic);
      }
    }
    expect(nextSteps("bundle", { themePushed: false })[0]!.title).toBe("Import the product");
    expect(
      nextSteps("push", { themePushed: true })
        .map((s) => s.body)
        .join(" "),
    ).toMatch(/Preview the unpublished StoreForge theme/);
  });
});
