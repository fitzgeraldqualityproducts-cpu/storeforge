import type { StepState, StepsState, WizardStep } from "@/lib/schemas";

/**
 * Which steps consume each step's output. When a step's data changes, everything reachable
 * from it in this graph becomes "stale" (if it already had content).
 */
export const STEP_DEPENDENTS: Record<WizardStep, WizardStep[]> = {
  input: ["analysis", "images"],
  analysis: ["brand", "listing", "content", "images"],
  brand: ["listing", "content", "export"],
  listing: ["content", "export"],
  images: ["export"],
  content: ["export"],
  export: [],
};

export type StepsPatch = Partial<Record<WizardStep, Partial<StepState>>>;

export function downstreamOf(changed: WizardStep[]): WizardStep[] {
  const seen = new Set<WizardStep>();
  const queue = [...changed];
  while (queue.length) {
    const s = queue.shift()!;
    for (const d of STEP_DEPENDENTS[s]) {
      if (!seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }
  for (const c of changed) seen.delete(c);
  return [...seen];
}

export function markStale(steps: StepsState, changed: WizardStep[]): StepsState {
  const next: StepsState = { ...steps };
  for (const s of downstreamOf(changed)) {
    const cur = next[s];
    if (cur.status === "ready") next[s] = { ...cur, status: "stale" };
  }
  return next;
}
