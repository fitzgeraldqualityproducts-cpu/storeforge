"use client";
import { ArrowLeftIcon, Loader2Icon, WandSparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/app/logo-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { useProjectEvents, useProjectView } from "@/hooks/use-project";
import type { PublicCapabilities } from "@/lib/config";
import { describeError } from "@/lib/client/api";
import { WIZARD_STEPS, type WizardStep } from "@/lib/schemas";
import { WizardProvider, useStartJob, type WizardCtx } from "./context";
import { JobStrip } from "./job-strip";
import { STEP_JOBS } from "./step-meta";
import { Stepper } from "./stepper";
import { InputStep } from "./steps/input-step";
import { AnalysisStep } from "./steps/analysis-step";
import { BrandStep } from "./steps/brand-step";
import { ListingStep } from "./steps/listing-step";
import { ImagesStep } from "./steps/images-step";
import { ContentStep } from "./steps/content-step";
import { ExportStep } from "./steps/export-step";

const STEP_COMPONENTS: Record<WizardStep, React.ComponentType> = {
  input: InputStep,
  analysis: AnalysisStep,
  brand: BrandStep,
  listing: ListingStep,
  images: ImagesStep,
  content: ContentStep,
  export: ExportStep,
};

export function Wizard({
  projectId,
  initialStep,
  capabilities,
}: {
  projectId: string;
  initialStep: WizardStep;
  capabilities: PublicCapabilities;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<WizardStep>(initialStep);
  const view = useProjectView(projectId);
  const events = useProjectEvents(projectId);

  const goTo = useCallback(
    (s: WizardStep) => {
      setStep(s);
      router.replace(`${pathname}?step=${s}`, { scroll: false });
      requestAnimationFrame(() => {
        document.getElementById("main")?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
    [pathname, router],
  );

  const activeJobs = useMemo(() => {
    const live = events.active;
    const persisted =
      view.data?.jobs.filter(
        (j) => (j.status === "queued" || j.status === "running") && !(j.id in events.jobs),
      ) ?? [];
    return [...live, ...persisted];
  }, [events.active, events.jobs, view.data]);

  const runningSteps = useMemo(() => {
    const set = new Set<WizardStep>();
    for (const s of WIZARD_STEPS) {
      if (activeJobs.some((j) => STEP_JOBS[s].includes(j.type) || j.type === "pipeline")) {
        if (s !== "input" && s !== "export") set.add(s);
      }
    }
    return set;
  }, [activeJobs]);

  if (view.isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 lg:grid-cols-[260px_1fr]">
        <Skeleton className="h-96" />
        <div className="grid gap-4">
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (view.isError || !view.data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load this project</AlertTitle>
          <AlertDescription>
            <p>{describeError(view.error)}</p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href="/">Back to projects</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const ctx: WizardCtx = {
    projectId,
    view: view.data,
    caps: capabilities,
    activeJobs,
    partials: events.partials,
    step,
    goTo,
  };
  const StepComponent = STEP_COMPONENTS[step];

  return (
    <WizardProvider value={ctx}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon-sm" asChild>
                <Link href="/" aria-label="All projects">
                  <ArrowLeftIcon />
                </Link>
              </Button>
              <LogoMark className="hidden sm:inline-flex" />
              <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
                /
              </span>
              <span className="truncate text-sm font-medium">
                {view.data.project.brandKit?.selectedName ?? view.data.project.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <RunAllButton />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-10">
          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <Stepper
              steps={view.data.project.steps}
              current={step}
              runningSteps={runningSteps}
              onSelect={goTo}
            />
            <div className="mt-6 hidden lg:block">
              <JobStrip jobs={activeJobs} />
            </div>
          </aside>
          <main id="main" tabIndex={-1} className="min-w-0 outline-none">
            <div className="mb-4 lg:hidden">
              <JobStrip jobs={activeJobs} />
            </div>
            <StepComponent />
          </main>
        </div>
      </div>
    </WizardProvider>
  );
}

function RunAllButton() {
  const start = useStartJob();
  return (
    <Button
      variant="ember"
      size="sm"
      onClick={() => start.mutate({ path: "pipeline" })}
      disabled={start.isPending}
      title="Run every generation step in order using the current inputs"
    >
      {start.isPending ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
      <span className="hidden sm:inline">Generate everything</span>
      <span className="sm:hidden">Generate</span>
    </Button>
  );
}
