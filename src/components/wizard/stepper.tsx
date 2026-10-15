"use client";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDashedIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { WIZARD_STEPS, type StepsState, type WizardStep } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { STEP_META } from "./step-meta";

function StatusIcon({ status, running }: { status: string; running: boolean }) {
  if (running)
    return <Loader2Icon className="size-3.5 animate-spin text-ember" aria-label="Running" />;
  if (status === "ready") return <CheckIcon className="size-3.5 text-success" aria-label="Ready" />;
  if (status === "stale")
    return <RefreshCwIcon className="size-3.5 text-warning" aria-label="Stale" />;
  if (status === "error")
    return <AlertTriangleIcon className="size-3.5 text-destructive" aria-label="Error" />;
  return <CircleDashedIcon className="size-3.5 text-muted-foreground" aria-label="Not started" />;
}

export function Stepper({
  steps,
  current,
  runningSteps,
  onSelect,
}: {
  steps: StepsState;
  current: WizardStep;
  runningSteps: Set<WizardStep>;
  onSelect: (s: WizardStep) => void;
}) {
  return (
    <nav aria-label="Wizard steps" className="w-full">
      <ol className="relative flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {WIZARD_STEPS.map((s) => {
          const meta = STEP_META[s];
          const active = s === current;
          const status = steps[s].status;
          return (
            <li key={s} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(s)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "bg-card shadow-sm ring-1 ring-border" : "hover:bg-card/60",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums",
                    active
                      ? "border-ember bg-ember text-ember-foreground"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  {meta.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {meta.title}
                    <StatusIcon status={status} running={runningSteps.has(s)} />
                  </span>
                  <span className="hidden text-xs text-muted-foreground lg:block">
                    {meta.blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
