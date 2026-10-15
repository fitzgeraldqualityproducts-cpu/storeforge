import "server-only";
import * as cheerio from "cheerio";
import { scrapeAllowlist } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { log } from "@/lib/log";
import { MAX_OPTIONS, MAX_VARIANTS, SourceExtraction, type ExtractionWarning } from "@/lib/schemas";
import { adapterFor } from "./adapters";
import { BrowserUnavailableError, renderWithBrowser } from "./browser";
import { detectWalls, isBlockingWarning } from "./detect";
import { FetchError, safeFetch } from "./http";
import { isThin, parseProductHtml, type ParsedPage } from "./parse";
import { robotsAllows } from "./robots";
import { assertSafeUrl, BlockedUrlError, type UrlPolicy } from "./ssrf";

export const CACHE_TTL_MS = 60 * 60 * 1000;

export interface LlmFallbackInput {
  url: string;
  text: string;
  screenshot: Buffer | null;
  partial: ParsedPage;
}
/** Vision/LLM extraction used when every structured method came up thin. */
export type LlmFallback = (input: LlmFallbackInput) => Promise<Partial<ParsedPage> | null>;

export interface ScrapeOptions {
  force?: boolean;
  policy?: UrlPolicy;
  useBrowser?: boolean;
  llmFallback?: LlmFallback | null;
  onProgress?: (message: string) => void;
}

export function defaultPolicy(): UrlPolicy {
  return { allowlist: scrapeAllowlist() };
}

function emptyParsed(): ParsedPage {
  return {
    title: null,
    description: null,
    price: null,
    brand: null,
    sku: null,
    gtin: null,
    availability: null,
    options: [],
    variants: [],
    specs: {},
    images: [],
    rating: null,
    shippingInfo: null,
    language: null,
    rawText: "",
    jsonLd: [],
  };
}

function merge(base: ParsedPage, extra: Partial<ParsedPage>): ParsedPage {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra) as [keyof ParsedPage, unknown][]) {
    const cur = out[k];
    const empty =
      cur == null ||
      (typeof cur === "string" && cur.length === 0) ||
      (Array.isArray(cur) && cur.length === 0) ||
      (typeof cur === "object" &&
        !Array.isArray(cur) &&
        cur !== null &&
        Object.keys(cur).length === 0);
    if (empty && v != null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

async function readCache(url: string): Promise<SourceExtraction | null> {
  const row = await prisma.scrapeCache.findUnique({ where: { url } });
  if (!row || Date.now() - row.createdAt.getTime() > CACHE_TTL_MS) return null;
  try {
    const parsed = SourceExtraction.safeParse(JSON.parse(row.result));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeCache(url: string, result: SourceExtraction) {
  await prisma.scrapeCache.upsert({
    where: { url },
    create: { url, result: JSON.stringify(result) },
    update: { result: JSON.stringify(result), createdAt: new Date() },
  });
}

/**
 * Extract product data from a URL.
 * Order: SSRF/robots checks → static fetch + parse (JSON-LD → microdata → OG → DOM) → site
 * adapter → headless browser if thin → LLM/vision fallback if still thin.
 * Never throws for expected failures: problems are returned as structured warnings.
 */
export async function scrapeUrl(
  rawUrl: string,
  opts: ScrapeOptions = {},
): Promise<SourceExtraction> {
  const policy = opts.policy ?? defaultPolicy();
  const progress = opts.onProgress ?? (() => undefined);
  const warnings: ExtractionWarning[] = [];
  const base = {
    url: rawUrl,
    fetchedAt: new Date().toISOString(),
    adapter: null as string | null,
  };

  if (!opts.force) {
    const cached = await readCache(rawUrl);
    if (cached) {
      progress("Using cached result (less than an hour old)");
      return cached;
    }
  }

  let url: URL;
  try {
    url = await assertSafeUrl(rawUrl, policy);
  } catch (err) {
    const message = err instanceof BlockedUrlError ? err.message : "This URL can't be fetched.";
    return SourceExtraction.parse({
      ...base,
      fetchMethod: "none",
      warnings: [{ code: "blocked_url", message }],
    });
  }

  progress("Checking robots.txt");
  if (!(await robotsAllows(url.toString(), policy))) {
    return SourceExtraction.parse({
      ...base,
      sourceDomain: url.hostname,
      fetchMethod: "none",
      warnings: [
        {
          code: "robots_disallowed",
          message:
            "This site's robots.txt asks automated tools not to read this page, so we didn't. Upload screenshots or photos instead.",
        },
      ],
    });
  }

  let parsed = emptyParsed();
  let html: string | null = null;
  let finalUrl = url.toString();
  let fetchMethod: SourceExtraction["fetchMethod"] = "static";
  let blocked = false;

  progress("Fetching page");
  try {
    const res = await safeFetch(url.toString(), { policy });
    finalUrl = res.finalUrl;
    const isHtml =
      /html|xml/i.test(res.contentType) || /^\s*</.test(res.body.subarray(0, 200).toString("utf8"));
    if (!isHtml) {
      warnings.push({
        code: "not_html",
        message: `The URL returned ${res.contentType || "non-HTML content"}, not a web page.`,
      });
    } else {
      html = res.body.toString("utf8");
      parsed = parseProductHtml(html, finalUrl);
      const walls = detectWalls(html, res.status, parsed.rawText);
      warnings.push(...walls);
      blocked = walls.some(isBlockingWarning);
      if (!blocked && res.status >= 400) {
        warnings.push({ code: "fetch_failed", message: `The page returned HTTP ${res.status}.` });
      }
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      warnings.push({ code: "blocked_url", message: err.message });
      return SourceExtraction.parse({
        ...base,
        sourceDomain: url.hostname,
        fetchMethod: "none",
        warnings,
      });
    }
    if (err instanceof FetchError && err.code === "too_large") {
      warnings.push({
        code: "too_large",
        message: "The page is larger than 5 MB, so we stopped reading it.",
      });
    } else if (err instanceof FetchError && err.code === "timeout") {
      warnings.push({
        code: "timeout",
        message: "The page took longer than 10 seconds to respond.",
      });
    } else {
      warnings.push({
        code: "fetch_failed",
        message: `We couldn't fetch the page: ${err instanceof Error ? err.message : "network error"}.`,
      });
    }
  }

  const adapter = adapterFor(new URL(finalUrl)) ?? adapterFor(url);
  if (adapter && !blocked) {
    progress(`Applying ${adapter.name} adapter`);
    const before = JSON.stringify(parsed);
    parsed = await adapter.enhance(parsed, {
      url: new URL(finalUrl),
      html,
      $: html ? cheerio.load(html) : null,
      policy,
    });
    if (JSON.stringify(parsed) !== before) base.adapter = adapter.name;
  }

  let screenshot: Buffer | null = null;
  if (!blocked && isThin(parsed) && opts.useBrowser !== false) {
    progress("Page looks JavaScript-rendered; opening a headless browser");
    try {
      const r = await renderWithBrowser(url.toString(), policy);
      screenshot = r.screenshot;
      const browserParsed = parseProductHtml(r.html, r.finalUrl);
      const walls = detectWalls(r.html, r.status, browserParsed.rawText);
      if (walls.some(isBlockingWarning)) {
        warnings.push(...walls.filter((w) => !warnings.some((x) => x.code === w.code)));
        blocked = true;
      } else {
        // The rendered DOM is the primary source; static/adapter values fill any gaps.
        const staticImages = parsed.images;
        parsed = merge(browserParsed, parsed);
        parsed.images = [
          ...staticImages.filter((i) => i.source === "adapter"),
          ...browserParsed.images,
          ...staticImages,
        ];
        fetchMethod = "browser";
        finalUrl = r.finalUrl;
        if (adapter) {
          parsed = await adapter.enhance(parsed, {
            url: new URL(finalUrl),
            html: r.html,
            $: cheerio.load(r.html),
            policy,
          });
        }
        // Drop static-fetch failure warnings that the browser overcame.
        for (let i = warnings.length - 1; i >= 0; i--) {
          if (["fetch_failed", "timeout"].includes(warnings[i]!.code)) warnings.splice(i, 1);
        }
      }
    } catch (err) {
      if (err instanceof BrowserUnavailableError) {
        warnings.push({ code: "browser_unavailable", message: err.message });
      } else {
        log.warn("scrape.browser_failed", { url: rawUrl, error: err });
        warnings.push({
          code: "fetch_failed",
          message: `The headless browser couldn't load the page: ${err instanceof Error ? err.message.split("\n")[0] : "error"}.`,
        });
      }
    }
  }

  if (!blocked && isThin(parsed) && (parsed.rawText.length > 0 || screenshot)) {
    if (opts.llmFallback) {
      progress("Asking the AI to read the page");
      try {
        const extra = await opts.llmFallback({
          url: finalUrl,
          text: parsed.rawText.slice(0, 12_000),
          screenshot,
          partial: parsed,
        });
        if (extra) {
          parsed = merge(parsed, extra);
          warnings.push({
            code: "llm_fallback_used",
            message:
              "Some fields were read by the AI from the page text/screenshot. Double-check them.",
          });
        }
      } catch (err) {
        log.warn("scrape.llm_fallback_failed", { url: rawUrl, error: err });
        warnings.push({
          code: "llm_fallback_unavailable",
          message: "The AI fallback couldn't read this page.",
        });
      }
    } else {
      warnings.push({
        code: "llm_fallback_unavailable",
        message:
          "Structured data was thin and AI extraction isn't configured, so some fields may be missing.",
      });
    }
  }

  if (isThin(parsed) && !blocked && !warnings.some((w) => w.code === "thin_content")) {
    warnings.push({
      code: "thin_content",
      message:
        "We found little product information on this page. Add photos or details in Step 1 to fill the gaps.",
    });
  }

  if (parsed.variants.length > MAX_VARIANTS || parsed.options.length > MAX_OPTIONS) {
    warnings.push({
      code: "variant_cap",
      message: `Shopify allows ${MAX_OPTIONS} options and ${MAX_VARIANTS} variants per product; extra options/variants were dropped.`,
    });
    parsed.options = parsed.options.slice(0, MAX_OPTIONS);
    parsed.variants = parsed.variants.slice(0, MAX_VARIANTS);
  }
  if (!blocked && parsed.images.length === 0 && html) {
    warnings.push({
      code: "no_images",
      message: "No product images were found on this page. Upload your own photos.",
    });
  }

  // A wall page's text describes the wall, not the product: never return it as product data.
  if (blocked) parsed = emptyParsed();

  const result = SourceExtraction.parse({
    ...base,
    ...parsed,
    finalUrl,
    sourceDomain: new URL(finalUrl).hostname.replace(/^www\./, ""),
    fetchMethod: base.adapter && fetchMethod === "static" ? "adapter" : fetchMethod,
    warnings,
  });
  // Only cache successful reads; failures should be retried for real next time.
  if (!blocked && result.title) await writeCache(rawUrl, result);
  return result;
}

export { BlockedUrlError };
