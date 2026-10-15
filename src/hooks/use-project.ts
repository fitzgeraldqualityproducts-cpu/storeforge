"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProjectView } from "@/lib/db/views";
import type { JobView } from "@/lib/schemas";
import { api } from "@/lib/client/api";

export const projectKey = (id: string) => ["project", id] as const;

export function useProjectView(id: string) {
  return useQuery({
    queryKey: projectKey(id),
    queryFn: () => api<ProjectView>(`/api/projects/${id}`),
  });
}

const JOB_LABELS: Record<string, string> = {
  extract: "Product extraction",
  images: "Image processing",
  analyze: "Product analysis",
  brand_names: "Brand names",
  brand_details: "Brand kit",
  listing: "Product listing",
  content: "Store content",
  seo: "SEO pass",
  regenerate: "Regeneration",
  pipeline: "Full pipeline",
  export_bundle: "Export bundle",
  export_shopify: "Shopify push",
};
export const jobLabel = (type: string) => JOB_LABELS[type] ?? type;

/**
 * Subscribes to the project's SSE stream. Keeps a live map of active jobs, refetches the
 * project when jobs finish, and toasts completions/failures.
 */
export function useProjectEvents(id: string) {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, JobView>>({});
  const [partials, setPartials] = useState<Record<string, unknown>>({});
  const [connected, setConnected] = useState(false);
  const seenFinal = useRef(new Set<string>());

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      es = new EventSource(`/api/projects/${id}/events`);
      es.addEventListener("ready", () => setConnected(true));
      es.addEventListener("job", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { job: JobView; partial?: unknown };
        const job = data.job;
        setJobs((prev) => ({ ...prev, [job.id]: job }));
        if (data.partial !== undefined) setPartials((p) => ({ ...p, [job.type]: data.partial }));
        const final = job.status === "succeeded" || job.status === "failed";
        if (final && !seenFinal.current.has(job.id)) {
          seenFinal.current.add(job.id);
          void qc.invalidateQueries({ queryKey: projectKey(id) });
          if (job.status === "succeeded") toast.success(`${jobLabel(job.type)} complete`);
          else toast.error(`${jobLabel(job.type)} failed`, { description: job.error ?? undefined });
        } else if (!final) {
          // Data written mid-job (e.g. pipeline steps) should appear without waiting for the end.
          if (job.percent % 20 === 0) void qc.invalidateQueries({ queryKey: projectKey(id) });
        }
      });
      es.addEventListener("project", () => void qc.invalidateQueries({ queryKey: projectKey(id) }));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [id, qc]);

  const active = Object.values(jobs).filter((j) => j.status === "queued" || j.status === "running");
  return { jobs, active, partials, connected };
}
