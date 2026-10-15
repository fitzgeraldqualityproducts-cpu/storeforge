import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/db/projects";
import { subscribeProject } from "@/lib/jobs/events";
import { enqueueJob, registerHandler, startRunner, waitForJob } from "@/lib/jobs/runner";

describe("job runner", () => {
  it("runs a job, streams progress events and is idempotent while active", async () => {
    await startRunner();
    registerHandler("seo", async (ctx) => {
      await ctx.progress("half", 50, "Halfway", { hello: "world" });
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true };
    });
    const project = await createProject("Runner test");
    const events: unknown[] = [];
    const unsub = subscribeProject(project.id, (e) => events.push(e));
    const a = await enqueueJob(project.id, "seo");
    const b = await enqueueJob(project.id, "seo");
    expect(b.id).toBe(a.id);
    const done = await waitForJob(a.id);
    unsub();
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual({ ok: true });
    expect(events.some((e) => (e as { partial?: unknown }).partial !== undefined)).toBe(true);
  });

  it("records a human-readable error when a handler throws", async () => {
    registerHandler("seo", async () => {
      throw new Error("Boom: the thing failed");
    });
    const project = await createProject("Runner fail");
    const job = await enqueueJob(project.id, "seo");
    const done = await waitForJob(job.id);
    expect(done.status).toBe("failed");
    expect(done.error).toContain("Boom");
  });
});
