"use client";
import { ConstructionIcon } from "lucide-react";
import { EmptyState, StepShell } from "../step-shell";

export function ImagesStep() {
  return (
    <StepShell step="images" description="">
      <EmptyState icon={ConstructionIcon} title="Built in a later milestone" />
    </StepShell>
  );
}
