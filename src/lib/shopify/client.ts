import { UserFacingError } from "@/lib/errors";
import { backoffDelay, sleep as realSleep } from "@/lib/retry";

/**
 * Minimal Shopify Admin GraphQL client: one POST per request, with throttling handled the way
 * Shopify documents it (read `extensions.cost.throttleStatus`, back off on THROTTLED), retries
 * with jitter on 429/5xx/network errors, and a hard timeout. The access token only ever lives
 * in this closure and the request header; it is never logged or put in an error message.
 */

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface QueryCost {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: ThrottleStatus;
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; [k: string]: unknown };
}

export interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
  extensions?: { cost?: QueryCost };
}

export interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

export interface AdminClient {
  readonly domain: string;
  readonly apiVersion: string;
  /** Run a query or mutation; throws on transport errors and top-level GraphQL errors. */
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  /** Upload a file to a target returned by stagedUploadsCreate. */
  uploadStaged(
    target: StagedTarget,
    file: { name: string; mimeType: string; data: Buffer },
  ): Promise<void>;
}

/** Thrown for problems the merchant can act on (bad token, missing scope, store not found). */
export class ShopifyError extends UserFacingError {
  constructor(
    message: string,
    public code: string = "SHOPIFY_ERROR",
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

/** A mutation returned `userErrors`. Messages come from Shopify and are safe to show. */
export class ShopifyUserErrors extends ShopifyError {
  constructor(
    public operation: string,
    public userErrors: { field?: string[] | null; message: string; code?: string | null }[],
  ) {
    super(
      `${operation}: ${userErrors
        .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
        .join("; ")}`,
      "USER_ERRORS",
    );
    this.name = "ShopifyUserErrors";
  }
}

export function assertNoUserErrors(
  operation: string,
  userErrors: { field?: string[] | null; message: string; code?: string | null }[] | undefined,
) {
  if (userErrors?.length) throw new ShopifyUserErrors(operation, userErrors);
}

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/**
 * Accepts "my-store", "my-store.myshopify.com" or an admin URL and returns
 * "my-store.myshopify.com". Only *.myshopify.com hosts are allowed, so a typed domain can
 * never point the server at an arbitrary host.
 */
export function normalizeShopDomain(input: string): string {
  let s = input.trim().toLowerCase();
  const admin = s.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) s = `${admin[1]}.myshopify.com`;
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) s = `${s}.myshopify.com`;
  if (!SHOP_DOMAIN_RE.test(s)) {
    throw new ShopifyError(
      'Enter your store\'s myshopify.com address, e.g. "my-store.myshopify.com" (Settings → Domains shows it).',
      "BAD_DOMAIN",
    );
  }
  return s;
}

export interface ClientOptions {
  domain: string;
  token: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Retries for throttling, 429/5xx and network errors. */
  maxRetries?: number;
  /** Keep this many cost points in reserve before sending the next request. */
  reservePoints?: number;
}

const isThrottled = (errors?: GraphQLError[]) =>
  Boolean(errors?.some((e) => e.extensions?.code === "THROTTLED"));

/** How long to wait until `needed` points are available again. */
export function throttleWaitMs(cost: QueryCost | undefined, needed?: number): number {
  const t = cost?.throttleStatus;
  if (!t || t.restoreRate <= 0) return 1000;
  const want = needed ?? cost.requestedQueryCost;
  const missing = Math.max(0, want - t.currentlyAvailable);
  return Math.max(250, Math.ceil((missing / t.restoreRate) * 1000));
}

function httpProblem(status: number, domain: string): ShopifyError | null {
  switch (status) {
    case 401:
      return new ShopifyError(
        `Shopify rejected the access token for ${domain}. Check you copied the Admin API access token (it starts with "shpat_") and that the app is installed.`,
        "UNAUTHORIZED",
      );
    case 402:
      return new ShopifyError(
        `${domain} is frozen or its plan has lapsed (Shopify returned "Payment required").`,
        "PAYMENT_REQUIRED",
      );
    case 403:
      return new ShopifyError(
        `The access token for ${domain} is missing a permission this step needs. Add the scopes listed in StoreForge to the custom app, reinstall it, and use the new token.`,
        "FORBIDDEN",
      );
    case 404:
      return new ShopifyError(
        `Couldn't find ${domain}, or it doesn't support this Admin API version. Check the store address and SHOPIFY_API_VERSION.`,
        "NOT_FOUND",
      );
    case 423:
      return new ShopifyError(`${domain} is locked by Shopify.`, "LOCKED");
    default:
      return null;
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    public waitMs?: number,
  ) {
    super(message);
  }
}

export function createAdminClient(opts: ClientOptions): AdminClient {
  const domain = normalizeShopDomain(opts.domain);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 6;
  const reserve = opts.reservePoints ?? 100;
  const endpoint = `https://${domain}/admin/api/${opts.apiVersion}/graphql.json`;
  let lastCost: QueryCost | undefined;
  let lastCostAt = 0;

  /** Wait proactively when the bucket is nearly empty instead of waiting to be throttled. */
  async function pace() {
    const t = lastCost?.throttleStatus;
    if (!t) return;
    const restored = ((Date.now() - lastCostAt) / 1000) * t.restoreRate;
    const available = Math.min(t.maximumAvailable, t.currentlyAvailable + restored);
    if (available < reserve) await sleep(Math.ceil(((reserve - available) / t.restoreRate) * 1000));
  }

  async function once<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Shopify-Access-Token": opts.token,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      throw new RetryableError(
        name === "TimeoutError" || name === "AbortError"
          ? `Shopify didn't answer within ${Math.round(timeoutMs / 1000)}s`
          : `Couldn't reach ${domain}`,
      );
    }
    const problem = httpProblem(res.status, domain);
    if (problem) throw problem;
    if (res.status === 429) {
      const after = Number(res.headers.get("Retry-After"));
      throw new RetryableError("Shopify rate limit", Number.isFinite(after) ? after * 1000 : 2000);
    }
    if (res.status >= 500) throw new RetryableError(`Shopify returned ${res.status}`);
    if (!res.ok) throw new ShopifyError(`Shopify returned HTTP ${res.status}.`, "HTTP");

    let body: GraphQLResponse<T>;
    try {
      body = (await res.json()) as GraphQLResponse<T>;
    } catch {
      throw new RetryableError("Shopify sent a response that isn't JSON");
    }
    if (body.extensions?.cost) {
      lastCost = body.extensions.cost;
      lastCostAt = Date.now();
    }
    if (isThrottled(body.errors)) {
      throw new RetryableError("Throttled", throttleWaitMs(body.extensions?.cost));
    }
    if (body.errors?.length) {
      const access = body.errors.find((e) => e.extensions?.code === "ACCESS_DENIED");
      if (access) {
        throw new ShopifyError(
          `Missing permission: ${access.message} Add the scopes listed in StoreForge to the custom app and use the new token.`,
          "ACCESS_DENIED",
        );
      }
      throw new ShopifyError(
        `Shopify couldn't run the request: ${body.errors.map((e) => e.message).join("; ")}`,
        "GRAPHQL",
      );
    }
    if (!body.data) throw new ShopifyError("Shopify returned no data.", "NO_DATA");
    return body.data;
  }

  async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await pace();
      try {
        return await once<T>(query, variables);
      } catch (err) {
        lastErr = err;
        if (!(err instanceof RetryableError) || attempt === maxRetries) break;
        await sleep(err.waitMs ?? backoffDelay(attempt, 500, 8000) + 250);
      }
    }
    if (lastErr instanceof RetryableError) {
      throw new ShopifyError(
        `${lastErr.message}. Check the store address and try again in a moment.`,
        "UNAVAILABLE",
      );
    }
    throw lastErr;
  }

  async function uploadStaged(
    target: StagedTarget,
    file: { name: string; mimeType: string; data: Buffer },
  ) {
    const url = new URL(target.url);
    if (url.protocol !== "https:") throw new ShopifyError("Shopify gave an insecure upload URL.");
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append(
        "file",
        new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
        file.name,
      );
      try {
        const res = await doFetch(target.url, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(Math.max(timeoutMs, 60_000)),
        });
        if (res.ok) return;
        lastErr = new Error(`upload returned ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastErr = err;
      }
      if (attempt < 3) await sleep(backoffDelay(attempt, 500, 8000) + 250);
    }
    throw new ShopifyError(
      `Couldn't upload ${file.name} to Shopify (${lastErr instanceof Error ? lastErr.message : "network error"}).`,
      "UPLOAD",
    );
  }

  return { domain, apiVersion: opts.apiVersion, request, uploadStaged };
}
