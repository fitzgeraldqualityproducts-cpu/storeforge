"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import type { PublicCapabilities } from "@/lib/config";
import type { ProjectView } from "@/lib/db/views";
import type { JobView, WizardStep } from "@/lib/schemas";
import { api, describeError, startJob } from "@/lib/client/api";
import { projectKey } from "@/hooks/use-project";

export interface WizardCtx {
  projectId: string;
  view: ProjectView;
  caps: PublicCapabilities;
  activeJobs: JobView[];
  partials: Record<string, unknown>;
  step: WizardStep;
  goTo: (s: WizardStep) => void;
}

const Ctx = createContext<WizardCtx | null>(null);
export const WizardProvider = Ctx.Provider;

export function useWizard() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWizard must be used inside the wizard");
  return v;
}

/** True while any job of the given types is queued/running for this project. */
export function useJobRunning(types: string[]) {
  const { activeJobs, view } = useWizard();
  const live = activeJobs.some((j) => types.includes(j.type));
  const persisted = view.jobs.some(
    (j) => types.includes(j.type) && (j.status === "queued" || j.status === "running"),
  );
  return live || persisted;
}

export function useActiveJob(types: string[]) {
  const { activeJobs, view } = useWizard();
  return (
    activeJobs.find((j) => types.includes(j.type)) ??
    view.jobs.find(
      (j) => types.includes(j.type) && (j.status === "queued" || j.status === "running"),
    ) ??
    null
  );
}

/** Latest finished job of these types (to show "retry this step" on failure). */
export function useLastJob(types: string[]) {
  const { view } = useWizard();
  return view.jobs.find((j) => types.includes(j.type)) ?? null;
}

type PatchBody = Partial<{
  name: string;
  inputs: ProjectView["project"]["inputs"];
  rightsAccepted: boolean;
  analysis: NonNullable<ProjectView["project"]["analysis"]>;
  brandKit: NonNullable<ProjectView["project"]["brandKit"]>;
  listing: NonNullable<ProjectView["project"]["listing"]>;
  listingMeta: NonNullable<ProjectView["project"]["listingMeta"]>;
  content: NonNullable<ProjectView["project"]["content"]>;
}>;

/** Autosaving project PATCH with optimistic cache update. */
export function usePatchProject(opts: { silent?: boolean } = {}) {
  const { projectId } = useWizard();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchBody) =>
      api<{ project: ProjectView["project"] }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: body,
      }),
    onSuccess: (data) => {
      qc.setQueryData<ProjectView>(projectKey(projectId), (old) =>
        old ? { ...old, project: data.project } : old,
      );
      if (!opts.silent) toast.success("Saved");
    },
    onError: (e) => toast.error("Couldn't save", { description: describeError(e) }),
  });
}

export function useStartJob() {
  const { projectId } = useWizard();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      startJob(projectId, path, body ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: projectKey(projectId) }),
    onError: (e) => toast.error(describeError(e)),
  });
}
