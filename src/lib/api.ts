import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError } from "@/lib/db/projects";
import { ensureRunner, UserFacingError } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import { clientIp, takeToken, type RateLimitPolicy } from "@/lib/security/rate-limit";
import { PathTraversalError } from "@/lib/security/paths";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "Invalid request",
      z.flattenError(parsed.error as z.ZodError<unknown>),
    );
  }
  return parsed.data;
}

export function rateLimit(req: Request, bucket: string, policy: RateLimitPolicy) {
  const r = takeToken(`${bucket}:${clientIp(req)}`, policy);
  if (!r.ok) {
    throw new HttpError(429, `Too many requests. Try again in ${r.retryAfterSec}s.`, {
      retryAfterSec: r.retryAfterSec,
    });
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler: starts the job runner, maps known errors to JSON responses. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      await ensureRunner();
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        const headers: Record<string, string> = {};
        if (err.status === 429 && err.details && typeof err.details === "object") {
          headers["Retry-After"] = String((err.details as { retryAfterSec: number }).retryAfterSec);
        }
        return NextResponse.json(
          { error: err.message, details: err.details ?? null },
          { status: err.status, headers },
        );
      }
      if (err instanceof NotFoundError) return json({ error: err.message }, 404);
      if (err instanceof PathTraversalError) return json({ error: "Invalid path" }, 400);
      if (err instanceof UserFacingError) return json({ error: err.message }, 422);
      log.error("route.error", { url: req.url, error: err });
      return json({ error: "Something went wrong on our side. Please retry." }, 500);
    }
  };
}
