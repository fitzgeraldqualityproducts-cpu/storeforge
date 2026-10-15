"use client";
import { ConstructionIcon } from "lucide-react";
import { EmptyState, StepShell } from "../step-shell";

export function InputStep() {
  return (
    <StepShell step="input" description="">
      <EmptyState icon={ConstructionIcon} title="Built in a later milestone" />
    </StepShell>
  );
}
