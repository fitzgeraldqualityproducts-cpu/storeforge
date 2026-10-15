import { aliexpressAdapter } from "./aliexpress";
import { amazonAdapter } from "./amazon";
import { etsyAdapter } from "./etsy";
import { shopifyAdapter } from "./shopify";
import type { SiteAdapter } from "./types";

export const ADAPTERS: SiteAdapter[] = [
  amazonAdapter,
  aliexpressAdapter,
  etsyAdapter,
  shopifyAdapter,
];

export function adapterFor(url: URL): SiteAdapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}

export type { SiteAdapter };
