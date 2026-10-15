import { describe, expect, it } from "vitest";
import { StepsState } from "@/lib/schemas";
import { downstreamOf, markStale } from "@/lib/staleness";

describe("staleness", () => {
  it("computes transitive downstream steps", () => {
    expect(new Set(downstreamOf(["input"]))).toEqual(
      new Set(["analysis", "images", "brand", "listing", "content", "export"]),
    );
    expect(downstreamOf(["export"])).toEqual([]);
  });

  it("marks only ready downstream steps stale", () => {
    const steps = StepsState.parse({
      input: { status: "ready" },
      analysis: { status: "ready" },
      brand: { status: "ready" },
      listing: { status: "empty" },
    });
    const next = markStale(steps, ["analysis"]);
    expect(next.analysis.status).toBe("ready");
    expect(next.brand.status).toBe("stale");
    expect(next.listing.status).toBe("empty");
  });
});
