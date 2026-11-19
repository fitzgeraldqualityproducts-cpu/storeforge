"use client";
import { ArrowLeftIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/app/logo-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { useProjectView } from "@/hooks/use-project";
import { StorePreview, previewHref } from "./preview-panel";
import { EmptyState } from "./step-shell";

/** The store preview on its own page, so it can sit in a separate browser tab. */
export function FullPagePreview({
  projectId,
  initialPath,
}: {
  projectId: string;
  initialPath: string;
}) {
  const view = useProjectView(projectId);
  const project = view.data?.project;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href={`/projects/${projectId}?step=export`} aria-label="Back to the project">
                <ArrowLeftIcon />
              </Link>
            </Button>
            <LogoMark className="hidden sm:inline-flex" />
            <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
              /
            </span>
            <h1 className="truncate text-sm font-medium">
              Store preview
              {project ? `: ${project.brandKit?.selectedName ?? project.name}` : ""}
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none">
        {view.isLoading ? (
          <Skeleton className="h-[70vh]" />
        ) : !project?.content ? (
          <EmptyState icon={StoreIcon} title="No store to preview yet">
            Generate the store content first, then come back here.
          </EmptyState>
        ) : (
          <StorePreview
            projectId={projectId}
            view={view.data!}
            content={project.content}
            initialPath={initialPath}
            showOpenInNewTab={false}
            onPathChange={(p) => window.history.replaceState(null, "", previewHref(projectId, p))}
          />
        )}
      </main>
    </div>
  );
}
