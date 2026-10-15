"use client";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WIZARD_STEPS, type WizardStep } from "@/lib/schemas";
import { STEP_META } from "./step-meta";
import { useLastJob, useWizard } from "./context";

/** Common frame for each step: heading, stale banner, failure + retry, back/next. */
export function StepShell({
  step,
  description,
  actions,
  children,
  onRegenerate,
  regenerating,
  jobTypes = [],
  onRetry,
}: {
  step: WizardStep;
  description: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  onRegenerate?: () => void;
  regenerating?: boolean;
  jobTypes?: string[];
  onRetry?: () => void;
}) {
  const { view, goTo } = useWizard();
  const meta = STEP_META[step];
  const status = view.project.steps[step];
  const lastJob = useLastJob(jobTypes);
  const idx = WIZARD_STEPS.indexOf(step);
  const prev = idx > 0 ? WIZARD_STEPS[idx - 1] : null;
  const next = idx < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[idx + 1] : null;

  return (
    <section
      aria-labelledby={`step-${step}-title`}
      className="animate-fade-up grid grid-cols-[minmax(0,1fr)] gap-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Step {meta.n} of 7
          </p>
          <h1 id={`step-${step}-title`} className="font-display text-4xl tracking-tight">
            {meta.title}
          </h1>
          <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>

      {status.status === "stale" && onRegenerate ? (
        <Alert variant="warning">
          <RefreshCwIcon />
          <AlertTitle>Upstream changes since this was generated</AlertTitle>
          <AlertDescription>
            <p>
              Something this step depends on was edited. Your edits here are kept until you
              regenerate.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Regenerate affected sections
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {lastJob?.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>The last run of this step failed</AlertTitle>
          <AlertDescription>
            <p>{lastJob.error}</p>
            {onRetry ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={onRetry}
                disabled={regenerating}
              >
                <RotateCcwIcon /> Retry this step
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {children}

      <footer className="mt-4 flex items-center justify-between border-t pt-5">
        {prev ? (
          <Button variant="ghost" onClick={() => goTo(prev)}>
            <ArrowLeftIcon /> {STEP_META[prev].title}
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button variant="outline" onClick={() => goTo(next)}>
            {STEP_META[next].title} <ArrowRightIcon />
          </Button>
        ) : null}
      </footer>
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <h2 className="font-medium">{title}</h2>
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
