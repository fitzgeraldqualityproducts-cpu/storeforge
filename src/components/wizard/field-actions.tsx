"use client";
import { RefreshCwIcon, ScissorsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TONES, type RegenerateSection } from "@/lib/schemas";
import { useJobRunning, useStartJob } from "./context";

/** Regenerate / Make shorter / Change tone for one field, run as a "regenerate" job. */
export function FieldActions({
  section,
  field,
  label,
  jobs,
}: {
  section: Extract<RegenerateSection, "listing_field" | "content_page">;
  field: string;
  label: string;
  /** Job types that make the buttons busy. */
  jobs: string[];
}) {
  const start = useStartJob();
  const busy = useJobRunning(jobs) || start.isPending;
  const run = (operation: "regenerate" | "shorten" | "change_tone", tone?: string) =>
    start.mutate({
      path: "regenerate",
      body: { section, field, operation, ...(tone ? { tone } : {}) },
    });
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={`${label} AI actions`}
    >
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => run("regenerate")}>
        <RefreshCwIcon /> Regenerate
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => run("shorten")}>
        <ScissorsIcon /> Make shorter
      </Button>
      <Select value="" onValueChange={(tone) => run("change_tone", tone)} disabled={busy}>
        <SelectTrigger className="h-7 w-auto gap-1 text-xs" aria-label={`Change tone of ${label}`}>
          <SelectValue placeholder="Change tone" />
        </SelectTrigger>
        <SelectContent>
          {TONES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
