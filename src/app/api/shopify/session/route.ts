import { NextResponse } from "next/server";
import { z } from "zod";
import { json, parseBody, rateLimit, route } from "@/lib/api";
import { env } from "@/lib/config";
import { POLICIES } from "@/lib/security/rate-limit";
import { createAdminClient, normalizeShopDomain } from "@/lib/shopify/client";
import {
  SHOPIFY_COOKIE,
  cookieOptions,
  resolveCredentials,
  sealCredentials,
} from "@/lib/shopify/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  storeDomain: z.string().min(1).max(200),
  accessToken: z.string().trim().min(10).max(200),
});

/** Which store this browser session pushes to (never returns the token). */
export const GET = route(async (req) => {
  const creds = resolveCredentials(req);
  return json({
    connected: Boolean(creds),
    domain: creds?.domain ?? null,
    source: creds?.source ?? null,
  });
});

/** Check a store domain + Admin API token, then keep them in an encrypted session cookie. */
export const POST = route(async (req) => {
  rateLimit(req, "shopify-session", POLICIES.export);
  const body = await parseBody(req, Body);
  const domain = normalizeShopDomain(body.storeDomain);
  const client = createAdminClient({
    domain,
    token: body.accessToken,
    apiVersion: env().SHOPIFY_API_VERSION,
    maxRetries: 2,
  });
  const data = await client.request<{ shop: { name: string; myshopifyDomain: string } }>(
    `query StoreForgeVerify { shop { name myshopifyDomain } }`,
  );
  const res = NextResponse.json({
    connected: true,
    domain,
    source: "session",
    shopName: data.shop.name,
  });
  res.cookies.set(SHOPIFY_COOKIE, sealCredentials(domain, body.accessToken), cookieOptions(req));
  return res;
});

/** Forget the session token. */
export const DELETE = route(async (req) => {
  const res = NextResponse.json({ connected: false });
  res.cookies.set(SHOPIFY_COOKIE, "", { ...cookieOptions(req), maxAge: 0 });
  return res;
});
