"use client";
import { ConstructionIcon } from "lucide-react";
import { EmptyState, StepShell } from "../step-shell";

export function ListingStep() {
  return (
    <StepShell step="listing" description="">
      <EmptyState icon={ConstructionIcon} title="Built in a later milestone" />
    </StepShell>
  );
}
