import "server-only";
import { randomUUID } from "node:crypto";
import type { Job as JobRow } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { log } from "@/lib/log";
import { JobType, type JobStatus, type JobView } from "@/lib/schemas";
import { UserFacingError } from "@/lib/errors";
import { emitProjectEvent } from "./events";

export interface JobContext {
  jobId: string;
  projectId: string;
  type: JobType;
  payload: Record<string, unknown>;
  /** Report progress. Percent is clamped to 0..100. `partial` is streamed to the client as-is. */
  progress: (step: string, percent: number, message: string, partial?: unknown) => Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export { UserFacingError };

interface RunnerState {
  handlers: Map<string, JobHandler>;
  running: Set<string>;
  runningProjects: Set<string>;
  started: boolean;
  ticking: boolean;
  timer?: NodeJS.Timeout;
}

const g = globalThis as unknown as { __storeforgeRunner?: RunnerState };
const state: RunnerState = g.__storeforgeRunner ?? {
  handlers: new Map(),
  running: new Set(),
  runningProjects: new Set(),
  started: false,
  ticking: false,
};
g.__storeforgeRunner = state;

const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3;

export function registerHandler(type: JobType, handler: JobHandler) {
  state.handlers.set(type, handler);
}

export function toJobView(row: JobRow): JobView {
  let result: unknown = null;
  if (row.result) {
    try {
      result = JSON.parse(row.result);
    } catch {
      result = null;
    }
  }
  return {
    id: row.id,
    projectId: row.projectId,
    type: JobType.parse(row.type),
    status: row.status as JobStatus,
    step: row.step,
    percent: row.percent,
    message: row.message,
    error: row.error,
    result,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function publish(row: JobRow, partial?: unknown) {
  emitProjectEvent(row.projectId, { kind: "job", job: toJobView(row), partial });
}

/**
 * Enqueue a job. Idempotent: if a job of the same type is already queued or running for the
 * project, that job is returned instead of creating a duplicate.
 */
export async function enqueueJob(
  projectId: string,
  type: JobType,
  payload: Record<string, unknown> = {},
): Promise<JobView> {
  const existing = await prisma.job.findFirst({
    where: { projectId, type, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return toJobView(existing);
  const row = await prisma.job.create({
    data: {
      id: randomUUID(),
      projectId,
      type,
      payload: JSON.stringify(payload),
      message: "Queued",
    },
  });
  await publish(row);
  kick();
  return toJobView(row);
}

export async function getJob(id: string) {
  const row = await prisma.job.findUnique({ where: { id } });
  return row ? toJobView(row) : null;
}

export async function listProjectJobs(projectId: string, take = 30) {
  const rows = await prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toJobView);
}

/** Wait until a job finishes (used by tests and the CLI pipeline). */
export async function waitForJob(id: string, timeoutMs = 120_000): Promise<JobView> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const j = await getJob(id);
    if (!j) throw new Error(`Job ${id} disappeared`);
    if (j.status === "succeeded" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for job ${id}`);
}

function errorMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  if (err instanceof Error) {
    // Keep internals out of the UI but stay specific enough to act on.
    return err.message.length > 400 ? `${err.message.slice(0, 400)}…` : err.message;
  }
  return "Unexpected error";
}

async function runJob(row: JobRow) {
  const handler = state.handlers.get(row.type);
  state.running.add(row.id);
  state.runningProjects.add(row.projectId);
  let current = await prisma.job.update({
    where: { id: row.id },
    data: {
      status: "running",
      startedAt: new Date(),
      attempts: { increment: 1 },
      message: "Starting…",
      error: null,
    },
  });
  await publish(current);
  const ctx: JobContext = {
    jobId: row.id,
    projectId: row.projectId,
    type: JobType.parse(row.type),
    payload: safeParse(row.payload),
    progress: async (step, percent, message, partial) => {
      current = await prisma.job.update({
        where: { id: row.id },
        data: { step, percent: Math.max(0, Math.min(100, Math.round(percent))), message },
      });
      await publish(current, partial);
    },
  };
  const t0 = Date.now();
  try {
    if (!handler) throw new Error(`No handler registered for job type "${row.type}"`);
    const result = await handler(ctx);
    current = await prisma.job.update({
      where: { id: row.id },
      data: {
        status: "succeeded",
        percent: 100,
        message: "Done",
        finishedAt: new Date(),
        result: result === undefined ? null : JSON.stringify(result),
      },
    });
    log.info("job.succeeded", { jobId: row.id, type: row.type, ms: Date.now() - t0 });
  } catch (err) {
    log.error("job.failed", { jobId: row.id, type: row.type, error: err });
    current = await prisma.job.update({
      where: { id: row.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: errorMessage(err),
        message: "Failed",
      },
    });
  } finally {
    state.running.delete(row.id);
    state.runningProjects.delete(row.projectId);
    await publish(current);
    emitProjectEvent(row.projectId, { kind: "project" });
    kick();
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    while (state.running.size < MAX_CONCURRENT) {
      const queued = await prisma.job.findMany({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      // One job per project at a time keeps writes to a project's JSON columns ordered.
      const next = queued.find(
        (j) => !state.running.has(j.id) && !state.runningProjects.has(j.projectId),
      );
      if (!next) break;
      void runJob(next);
      // runJob marks the project busy synchronously before its first await.
    }
  } catch (err) {
    log.error("runner.tick_failed", { error: err });
  } finally {
    state.ticking = false;
  }
}

export function kick() {
  setImmediate(() => void tick());
}

/**
 * Start the runner once per process: re-queue jobs interrupted by a restart (resumable), then
 * poll as a safety net in case a kick is missed.
 */
export async function startRunner() {
  if (state.started) return;
  state.started = true;
  const { registerAllHandlers } = await import("./handlers");
  registerAllHandlers();
  const interrupted = await prisma.job.findMany({ where: { status: "running" } });
  for (const j of interrupted) {
    if (j.attempts >= MAX_ATTEMPTS) {
      await prisma.job.update({
        where: { id: j.id },
        data: {
          status: "failed",
          error: "The server restarted repeatedly while this step was running. Retry it.",
          finishedAt: new Date(),
        },
      });
    } else {
      await prisma.job.update({
        where: { id: j.id },
        data: { status: "queued", message: "Resuming after restart" },
      });
      log.info("job.resumed", { jobId: j.id, type: j.type });
    }
  }
  state.timer = setInterval(() => void tick(), 2000);
  state.timer.unref?.();
  kick();
}

/** Ensure the runner is started; safe to call from any route handler. */
export async function ensureRunner() {
  if (!state.started) await startRunner();
}
