export interface RetryOptions {
  retries: number;
  baseMs?: number;
  maxMs?: number;
  /** Return false to stop retrying for this error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 8000) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(Math.random() * cap);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  o: RetryOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === o.retries || (o.shouldRetry && !o.shouldRetry(err, attempt))) break;
      const delay = backoffDelay(attempt, o.baseMs, o.maxMs);
      o.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Rejects with a TimeoutError if the promise does not settle within ms. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what = "Operation"): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new TimeoutError(what, ms)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Runs tasks with a concurrency limit, preserving result order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
