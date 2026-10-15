import { describe, expect, it } from "vitest";
import { takeToken } from "@/lib/security/rate-limit";
import { PathTraversalError, assertSafeFileName, safeJoin } from "@/lib/security/paths";

describe("rate limit token bucket", () => {
  it("allows a burst up to capacity then refills", () => {
    const policy = { capacity: 3, refillPerSec: 1 };
    const t = 1_000_000;
    expect(takeToken("k1", policy, t).ok).toBe(true);
    expect(takeToken("k1", policy, t).ok).toBe(true);
    expect(takeToken("k1", policy, t).ok).toBe(true);
    const blocked = takeToken("k1", policy, t);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(takeToken("k1", policy, t + 1000).ok).toBe(true);
  });
});

describe("path traversal protection", () => {
  it("keeps joined paths inside the root", () => {
    expect(safeJoin("/data", "a", "b.txt")).toBe("/data/a/b.txt");
    expect(() => safeJoin("/data", "../etc/passwd")).toThrow(PathTraversalError);
    expect(() => safeJoin("/data", "a/../../x")).toThrow(PathTraversalError);
  });
  it("rejects unsafe file names", () => {
    expect(assertSafeFileName("cozy-pillow-1.webp")).toBe("cozy-pillow-1.webp");
    expect(() => assertSafeFileName("../x")).toThrow();
    expect(() => assertSafeFileName(".hidden")).toThrow();
    expect(() => assertSafeFileName("a/b")).toThrow();
  });
});
