"use client";
import { ConstructionIcon } from "lucide-react";
import { EmptyState, StepShell } from "../step-shell";

export function ContentStep() {
  return (
    <StepShell step="content" description="">
      <EmptyState icon={ConstructionIcon} title="Built in a later milestone" />
    </StepShell>
  );
}
