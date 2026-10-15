import { getProject } from "@/lib/db/projects";
import { route } from "@/lib/api";
import { subscribeProject } from "@/lib/jobs/events";
import { listProjectJobs } from "@/lib/jobs/runner";
import type { JobEvent } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-Sent Events stream of job progress for a project. On connect it replays the latest
 * state of active jobs, then streams `job` events (step, percent, message, partial results)
 * and `project` events (data changed; refetch).
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await getProject(id);
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send("ready", { projectId: id });
      const jobs = await listProjectJobs(id, 10);
      for (const job of jobs.filter((j) => j.status === "queued" || j.status === "running")) {
        send("job", { kind: "job", job } satisfies JobEvent);
      }
      const unsubscribe = subscribeProject(id, (e) => send(e.kind, e));
      const heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15000);
      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
