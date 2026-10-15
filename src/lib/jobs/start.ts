import "server-only";
import { z } from "zod";
import { HttpError, json, parseBody, rateLimit, route } from "@/lib/api";
import { prisma } from "@/lib/db/client";
import { getProject, type ProjectRecord } from "@/lib/db/projects";
import type { JobType } from "@/lib/schemas";
import { POLICIES, type RateLimitPolicy } from "@/lib/security/rate-limit";
import { enqueueJob } from "./runner";

/** Every generation step needs the rights acknowledgement and at least one URL or image. */
export async function assertInputsReady(project: ProjectRecord) {
  if (!project.rightsAck.accepted) {
    throw new HttpError(
      422,
      "Confirm you have the right to use these images and product information (Step 1) first.",
    );
  }
  const images = await prisma.asset.count({ where: { projectId: project.id, discarded: false } });
  if (!project.inputs.urls.length && images === 0) {
    throw new HttpError(422, "Add at least one product URL or image in Step 1 first.");
  }
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * Build a POST handler that validates the body, checks prerequisites and enqueues a job.
 * Idempotent: an already queued/running job of the same type is returned instead.
 */
export function jobRoute<T extends z.ZodType>(opts: {
  /** Fixed job type, or chosen from the validated body (e.g. brand names vs details). */
  type: JobType | ((body: z.infer<T>) => JobType);
  body?: T;
  policy?: RateLimitPolicy;
  bucket?: string;
  check?: (project: ProjectRecord, body: z.infer<T>) => Promise<void> | void;
}) {
  return route<Ctx>(async (req, { params }) => {
    const { id } = await params;
    rateLimit(req, opts.bucket ?? "ai", opts.policy ?? POLICIES.ai);
    const body = opts.body ? await parseBody(req, opts.body) : {};
    const project = await getProject(id);
    await assertInputsReady(project);
    await opts.check?.(project, body as z.infer<T>);
    const type = typeof opts.type === "function" ? opts.type(body as z.infer<T>) : opts.type;
    const job = await enqueueJob(id, type, body as Record<string, unknown>);
    return json({ job }, 202);
  });
}
