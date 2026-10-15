import "server-only";
import dns from "node:dns";
import { existsSync } from "node:fs";
import { log } from "@/lib/log";
import { userAgent } from "./http";
import { assertUrlShape, hostKey, isBlockedAddress, type UrlPolicy } from "./ssrf";

export interface BrowserResult {
  html: string;
  finalUrl: string;
  status: number;
  screenshot: Buffer | null;
}

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

const SHOW_MORE =
  /^(show|read|see|view) (more|all|full)|more details|full description|specifications$/i;

function executablePath(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return undefined;
}

async function requestAllowed(raw: string, policy: UrlPolicy): Promise<boolean> {
  try {
    const u = assertUrlShape(raw, policy);
    if (policy.allowlist.has(hostKey(u))) return true;
    const addrs = await dns.promises.lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true });
    return addrs.length > 0 && !addrs.some((a) => isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * Render a JS-heavy page in headless Chromium: wait for network idle, scroll to trigger lazy
 * images, expand obvious "show more" toggles. Every request the page makes passes the SSRF guard.
 * Bot challenges are never solved or bypassed.
 */
export async function renderWithBrowser(
  url: string,
  policy: UrlPolicy,
  timeoutMs = 25_000,
): Promise<BrowserResult> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new BrowserUnavailableError("Playwright is not installed.");
  }
  let browser: import("playwright").Browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: executablePath() });
  } catch (err) {
    log.warn("browser.launch_failed", { error: err });
    throw new BrowserUnavailableError(
      "Headless Chromium isn't installed. Run `npx playwright install chromium` to enable JS-rendered pages.",
    );
  }
  try {
    const context = await browser.newContext({
      userAgent: userAgent(),
      viewport: { width: 1280, height: 1600 },
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const req = route.request();
      const type = req.resourceType();
      if (type === "media" || type === "font" || type === "websocket") return route.abort();
      if (!(await requestAllowed(req.url(), policy))) return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Re-check every hop of the navigation's redirect chain (redirects aren't routed individually).
    for (let r = resp?.request() ?? null; r; r = r.redirectedFrom()) {
      if (!(await requestAllowed(r.url(), policy))) {
        throw new Error("The page redirected to a private or reserved address.");
      }
    }
    if (!(await requestAllowed(page.url(), policy))) {
      throw new Error("The page redirected to a private or reserved address.");
    }
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(10_000, timeoutMs) })
      .catch(() => undefined);
    // Scroll to trigger lazy-loaded images.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(250);
    }
    // Expand obvious "show more" toggles (buttons/links only, at most 5).
    const toggles = page.locator("button, a[role=button], summary");
    const count = Math.min(await toggles.count(), 80);
    let clicked = 0;
    for (let i = 0; i < count && clicked < 5; i++) {
      const el = toggles.nth(i);
      const text = ((await el.textContent().catch(() => "")) ?? "").trim();
      if (text.length < 40 && SHOW_MORE.test(text) && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 1500, noWaitAfter: true }).catch(() => undefined);
        clicked++;
      }
    }
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
    await page.evaluate(() => window.scrollTo(0, 0));
    const html = await page.content();
    const screenshot = await page
      .screenshot({ type: "jpeg", quality: 70, fullPage: false })
      .catch(() => null);
    return { html, finalUrl: page.url(), status: resp?.status() ?? 0, screenshot };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
