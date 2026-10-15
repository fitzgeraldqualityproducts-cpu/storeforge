import type { JobView } from "@/lib/schemas";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errField =
      data && typeof data === "object" && "error" in data
        ? (data as { error: unknown }).error
        : null;
    const msg =
      typeof errField === "string" && errField ? errField : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, (data as { details?: unknown } | null)?.details);
  }
  return data as T;
}

/** Start a server job for a project step. */
export function startJob(projectId: string, path: string, body: unknown = {}) {
  return api<{ job: JobView }>(`/api/projects/${projectId}/${path}`, {
    method: "POST",
    json: body,
  });
}

export function describeError(err: unknown) {
  if (err instanceof ApiError) {
    const details = err.details as {
      fieldErrors?: Record<string, string[]>;
      formErrors?: string[];
    } | null;
    const field = details?.fieldErrors
      ? Object.entries(details.fieldErrors)
          .map(([k, v]) => `${k}: ${v.join(", ")}`)
          .join("; ")
      : "";
    return field ? `${err.message} (${field})` : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
