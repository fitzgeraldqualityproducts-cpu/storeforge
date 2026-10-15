"use client";
import { ConstructionIcon } from "lucide-react";
import { EmptyState, StepShell } from "../step-shell";

export function AnalysisStep() {
  return (
    <StepShell step="analysis" description="">
      <EmptyState icon={ConstructionIcon} title="Built in a later milestone" />
    </StepShell>
  );
}
