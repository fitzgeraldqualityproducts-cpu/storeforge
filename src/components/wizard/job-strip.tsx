"use client";
import { Loader2Icon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { jobLabel } from "@/hooks/use-project";
import type { JobView } from "@/lib/schemas";

/** Live progress of active jobs (from SSE). Announced politely to screen readers. */
export function JobStrip({ jobs }: { jobs: JobView[] }) {
  if (!jobs.length) return null;
  return (
    <div className="grid gap-2" aria-live="polite">
      {jobs.map((j) => (
        <div key={j.id} className="animate-fade-up rounded-lg border bg-card px-4 py-3 shadow-xs">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Loader2Icon className="size-4 shrink-0 animate-spin text-ember" />
              <span className="truncate">
                {jobLabel(j.type)}
                {j.step ? (
                  <span className="font-normal text-muted-foreground"> · {j.step}</span>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{j.percent}%</span>
          </div>
          <Progress value={j.percent} aria-label={`${jobLabel(j.type)} progress`} />
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{j.message}</p>
        </div>
      ))}
    </div>
  );
}
