import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config";
import { normalizeShopDomain } from "./client";

/**
 * Session-only Shopify credentials. A token typed into the app is never written to disk: it is
 * sealed (AES-256-GCM) into an httpOnly, SameSite=Strict cookie and, while a push job runs,
 * held in this process's memory. The key comes from SESSION_SECRET, or is random per process
 * (so a restart forgets every token).
 */

export const SHOPIFY_COOKIE = "sf_shopify";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface ShopifyCredentials {
  domain: string;
  token: string;
  source: "session" | "env";
}

const g = globalThis as unknown as {
  __storeforgeSessionKey?: Buffer;
  __storeforgeVault?: Map<string, { creds: ShopifyCredentials; expires: number }>;
};

function key(): Buffer {
  const secret = env().SESSION_SECRET;
  if (secret) return createHash("sha256").update(secret).digest();
  g.__storeforgeSessionKey ??= randomBytes(32);
  return g.__storeforgeSessionKey;
}

export function sealCredentials(domain: string, token: string, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plain = Buffer.from(JSON.stringify({ d: domain, t: token, e: now + SESSION_TTL_MS }));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function openCredentials(sealed: string, now = Date.now()): ShopifyCredentials | null {
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    const v = JSON.parse(plain.toString("utf8")) as { d?: string; t?: string; e?: number };
    if (!v.d || !v.t || !v.e || v.e < now) return null;
    return { domain: normalizeShopDomain(v.d), token: v.t, source: "session" };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** Credentials from server env vars, if both are set. */
export function envCredentials(): ShopifyCredentials | null {
  const e = env();
  if (!e.SHOPIFY_STORE_DOMAIN || !e.SHOPIFY_ADMIN_ACCESS_TOKEN) return null;
  try {
    return {
      domain: normalizeShopDomain(e.SHOPIFY_STORE_DOMAIN),
      token: e.SHOPIFY_ADMIN_ACCESS_TOKEN,
      source: "env",
    };
  } catch {
    return null;
  }
}

/** The session cookie wins over env vars, so a merchant can push to a store of their choice. */
export function resolveCredentials(req: Request): ShopifyCredentials | null {
  const sealed = readCookie(req, SHOPIFY_COOKIE);
  const fromCookie = sealed ? openCredentials(sealed) : null;
  return fromCookie ?? envCredentials();
}

export function cookieOptions(req: Request, maxAgeSec = SESSION_TTL_MS / 1000) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: maxAgeSec,
  };
}

// ---- in-memory hand-off to the push job (job payloads are stored in the database) ----

function vault() {
  g.__storeforgeVault ??= new Map();
  return g.__storeforgeVault;
}

export function stashForJob(projectId: string, creds: ShopifyCredentials) {
  vault().set(projectId, { creds, expires: Date.now() + 30 * 60 * 1000 });
}

export function credentialsForJob(projectId: string, domain: string): ShopifyCredentials | null {
  const v = vault().get(projectId);
  if (v && v.expires > Date.now() && v.creds.domain === domain) return v.creds;
  const fromEnv = envCredentials();
  return fromEnv && fromEnv.domain === domain ? fromEnv : null;
}

export function clearForJob(projectId: string) {
  vault().delete(projectId);
}
