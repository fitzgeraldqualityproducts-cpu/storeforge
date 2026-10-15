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
