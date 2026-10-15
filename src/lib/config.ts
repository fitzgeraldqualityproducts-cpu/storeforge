import "server-only";
import path from "node:path";
import { z } from "zod";
import { APP_NAME } from "./brand-constants";

export { APP_NAME };

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v;

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().default("claude-sonnet-5-5")),
  AI_MODE: z.preprocess(emptyToUndefined, z.enum(["live", "fixture"]).default("live")),
  APP_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://localhost:3000")),
  PUBLIC_IMAGE_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SHOPIFY_STORE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  SHOPIFY_API_VERSION: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-(01|04|07|10)$/, "Shopify API versions look like 2026-10")
      .default("2026-10"),
  ),
  REMOVE_BG_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["none", "removebg", "photoroom"]).default("none"),
  ),
  REMOVE_BG_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  MAX_UPLOAD_MB: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(100).default(15)),
  DATA_RETENTION_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30),
  ),
  SCRAPE_ALLOWLIST: z.preprocess(emptyToUndefined, z.string().default("")),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().default("data")),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed, validated server environment. Never import this from client components. */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached env so changes to process.env take effect. */
export function resetEnvCache() {
  cached = null;
}

export function dataDir(...parts: string[]) {
  return path.resolve(process.cwd(), env().DATA_DIR, ...parts);
}

export function isAiConfigured() {
  const e = env();
  return e.AI_MODE === "fixture" || Boolean(e.ANTHROPIC_API_KEY);
}

export function scrapeAllowlist(): Set<string> {
  return new Set(
    env()
      .SCRAPE_ALLOWLIST.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Capabilities exposed to the client (no secrets). */
export function publicCapabilities() {
  const e = env();
  return {
    appName: APP_NAME,
    aiConfigured: isAiConfigured(),
    aiMode: e.AI_MODE,
    model: e.ANTHROPIC_MODEL,
    shopifyEnvConfigured: Boolean(e.SHOPIFY_STORE_DOMAIN && e.SHOPIFY_ADMIN_ACCESS_TOKEN),
    shopifyEnvDomain: e.SHOPIFY_STORE_DOMAIN ?? null,
    shopifyApiVersion: e.SHOPIFY_API_VERSION,
    removeBgProvider: e.REMOVE_BG_PROVIDER,
    removeBgConfigured: e.REMOVE_BG_PROVIDER !== "none" && Boolean(e.REMOVE_BG_API_KEY),
    maxUploadMb: e.MAX_UPLOAD_MB,
    appBaseUrl: e.APP_BASE_URL,
    appBaseUrlIsLocal: /^(https?:\/\/)(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(e.APP_BASE_URL),
    isDev: process.env.NODE_ENV !== "production",
  };
}
export type PublicCapabilities = ReturnType<typeof publicCapabilities>;
