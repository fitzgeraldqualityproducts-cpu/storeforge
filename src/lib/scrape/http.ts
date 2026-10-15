import { Agent, request, type Dispatcher } from "undici";
import { APP_NAME, APP_VERSION } from "@/lib/brand-constants";
import { backoffDelay, sleep } from "@/lib/retry";
import { assertSafeUrl, BlockedUrlError, hostKey, makeGuardedLookup, type UrlPolicy } from "./ssrf";

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

export function userAgent(baseUrl = process.env.APP_BASE_URL || "http://localhost:3000") {
  return `${APP_NAME}Bot/${APP_VERSION} (+${baseUrl}; product research tool; respects robots.txt)`;
}
export const ROBOTS_UA_TOKEN = `${APP_NAME}Bot`;

export class FetchError extends Error {
  constructor(
    message: string,
    public code: "timeout" | "too_large" | "http" | "network" | "redirects",
    public status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface SafeResponse {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface SafeFetchOptions {
  policy: UrlPolicy;
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  /** Retries on network errors / 5xx / 429 with jittered backoff. */
  retries?: number;
}

function headerValue(h: Dispatcher.ResponseData["headers"][string]): string {
  return Array.isArray(h) ? h.join(", ") : (h ?? "");
}

async function readCapped(
  body: Dispatcher.ResponseData["body"],
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += b.byteLength;
    if (size > maxBytes) {
      body.on("error", () => undefined);
      body.destroy();
      throw new FetchError(
        `Response larger than ${Math.round(maxBytes / 1024 / 1024)} MB`,
        "too_large",
      );
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function fetchOnce(raw: string, o: SafeFetchOptions): Promise<SafeResponse> {
  const timeoutMs = o.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBytes = o.maxBytes ?? MAX_HTML_BYTES;
  let current = raw;
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertSafeUrl(current, o.policy);
    const port = hostKey(u).split(":").pop()!;
    const agent = new Agent({
      connect: { lookup: makeGuardedLookup(o.policy, () => port), timeout: timeoutMs },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const remaining = Math.max(1, deadline - Date.now());
    const signal = AbortSignal.timeout(remaining);
    try {
      const res = await request(u.toString(), {
        method: "GET",
        dispatcher: agent,
        signal,
        headers: {
          "user-agent": userAgent(),
          accept: o.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.8",
        },
      });
      const location = headerValue(res.headers.location);
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.body.on("error", () => undefined);
        res.body.destroy();
        current = new URL(location, u).toString();
        continue;
      }
      const body = await readCapped(res.body, maxBytes);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) headers[k] = headerValue(v);
      return {
        url: raw,
        finalUrl: u.toString(),
        status: res.statusCode,
        contentType: headers["content-type"] ?? "",
        headers,
        body,
      };
    } catch (err) {
      if (err instanceof BlockedUrlError || err instanceof FetchError) throw err;
      const e = err as { name?: string; code?: string; cause?: { code?: string } };
      if (e.code === "EBLOCKED" || e.cause?.code === "EBLOCKED") {
        throw new BlockedUrlError("The address resolved to a private or reserved network.");
      }
      if (e.name === "TimeoutError" || e.name === "AbortError" || e.code?.includes("TIMEOUT")) {
        throw new FetchError(`Timed out after ${Math.round(timeoutMs / 1000)}s`, "timeout");
      }
      throw new FetchError(err instanceof Error ? err.message : "Network error", "network");
    } finally {
      void agent.close();
    }
  }
  throw new FetchError(`More than ${MAX_REDIRECTS} redirects`, "redirects");
}

/**
 * GET a URL with SSRF protection on every hop, a timeout, a response size cap and an honest
 * User-Agent. Retries transient failures (network, 429, 5xx) with jitter.
 */
export async function safeFetch(raw: string, o: SafeFetchOptions): Promise<SafeResponse> {
  const retries = o.retries ?? 1;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(raw, o);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(backoffDelay(attempt, 400, 3000));
        continue;
      }
      return res;
    } catch (err) {
      last = err;
      const retryable =
        err instanceof FetchError && (err.code === "network" || err.code === "timeout");
      if (!retryable || attempt === retries) throw err;
      await sleep(backoffDelay(attempt, 400, 3000));
    }
  }
  throw last;
}
