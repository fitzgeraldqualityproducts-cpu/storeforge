/**
 * In-memory token bucket per (bucket, client IP). Good enough for a single-process local app;
 * swap for a shared store if you ever run multiple instances.
 */
interface Bucket {
  tokens: number;
  updated: number;
}

export interface RateLimitPolicy {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

export const POLICIES = {
  ai: { capacity: 20, refillPerSec: 20 / 60 },
  scrape: { capacity: 10, refillPerSec: 10 / 60 },
  upload: { capacity: 30, refillPerSec: 30 / 60 },
  export: { capacity: 10, refillPerSec: 10 / 60 },
} satisfies Record<string, RateLimitPolicy>;

const g = globalThis as unknown as { __storeforgeBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = g.__storeforgeBuckets ?? new Map();
g.__storeforgeBuckets = buckets;

export function takeToken(
  key: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const b = buckets.get(key) ?? { tokens: policy.capacity, updated: now };
  const elapsed = (now - b.updated) / 1000;
  b.tokens = Math.min(policy.capacity, b.tokens + elapsed * policy.refillPerSec);
  b.updated = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(key, b);
    return { ok: true, retryAfterSec: 0 };
  }
  buckets.set(key, b);
  return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / policy.refillPerSec) };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export function resetRateLimits() {
  buckets.clear();
}
