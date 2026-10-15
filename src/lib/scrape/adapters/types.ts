import type { CheerioAPI } from "cheerio";
import type { ParsedPage } from "../parse";
import type { UrlPolicy } from "../ssrf";

export interface AdapterContext {
  url: URL;
  html: string | null;
  $: CheerioAPI | null;
  policy: UrlPolicy;
}

/**
 * Site-specific enhancement. Adapters are optional: they refine the generic parse (which always
 * runs first) and must never throw; on any problem they return the input unchanged.
 */
export interface SiteAdapter {
  name: string;
  matches(url: URL): boolean;
  enhance(parsed: ParsedPage, ctx: AdapterContext): Promise<ParsedPage>;
}
