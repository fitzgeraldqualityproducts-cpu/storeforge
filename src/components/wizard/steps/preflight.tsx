"use client";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  ExternalLinkIcon,
  PartyPopperIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nextSteps } from "@/lib/export/next-steps";
import type { Preflight, PreflightItem } from "@/lib/export/preflight";
import { STEP_META } from "../step-meta";
import { useWizard } from "../context";

function ItemIcon({ status }: { status: PreflightItem["status"] }) {
  if (status === "pass")
    return <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
  if (status === "fail")
    return <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />;
  return (
    <AlertTriangleIcon
      className="mt-0.5 size-4 shrink-0 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]"
      aria-hidden="true"
    />
  );
}

const STATUS_TEXT: Record<PreflightItem["status"], string> = {
  pass: "Passed",
  fail: "Needs fixing",
  warn: "Check",
};

export function PreflightList({
  preflight,
  compact = false,
}: {
  preflight: Preflight;
  compact?: boolean;
}) {
  const { goTo } = useWizard();
  return (
    <ul className="grid gap-2">
      {preflight.items.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 rounded-lg border bg-background p-3 text-sm"
        >
          <ItemIcon status={item.status} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="font-medium">
              {item.label}
              <span className="sr-only">: {STATUS_TEXT[item.status]}</span>
            </p>
            {!compact || item.status !== "pass" ? (
              <p className="text-muted-foreground break-words">{item.detail}</p>
            ) : null}
          </div>
          {item.status !== "pass" ? (
            <Button size="xs" variant="outline" onClick={() => goTo(item.step)}>
              {item.status === "fail" ? "Fix" : "Review"}
              <span className="sr-only"> in {STEP_META[item.step].title}</span>
              <ArrowRightIcon />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function PreflightCard() {
  const { view } = useWizard();
  const pf = view.preflight;
  const passed = pf.items.filter((i) => i.status === "pass").length;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheckIcon className="size-5" aria-hidden="true" /> Pre-flight checklist
          </CardTitle>
          <Badge variant={pf.ok ? "success" : "destructive"}>
            {pf.ok ? "Ready" : `${pf.failed} to fix`}
          </Badge>
        </div>
        <CardDescription>
          {passed} of {pf.items.length} checks passed
          {pf.warnings ? `, ${pf.warnings} to double-check` : ""}. Items marked to fix block pushing
          to Shopify; you can still download the bundle.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PreflightList preflight={pf} />
      </CardContent>
    </Card>
  );
}

export function SupplierDisclaimer() {
  return (
    <Alert>
      <ShieldAlertIcon aria-hidden="true" />
      <AlertTitle>Before you sell</AlertTitle>
      <AlertDescription>
        This tool doesn&apos;t verify supplier reliability, product safety, or regulatory
        compliance. Check those yourself, and have a lawyer review your policies.
      </AlertDescription>
    </Alert>
  );
}

export function StoreReadyCard() {
  const { view } = useWizard();
  const push = view.exports.find(
    (e) =>
      e.type === "shopify" &&
      e.shopifyResult &&
      !e.shopifyResult.dryRun &&
      e.shopifyResult.steps.find((s) => s.step === "product")?.status === "succeeded",
  );
  const bundle = view.exports.find((e) => e.type === "bundle");
  if (!push && !bundle) return null;
  const path = push ? "push" : "bundle";
  const store = push?.storeDomain?.replace(/\.myshopify\.com$/, "") ?? null;
  const themePushed =
    push?.shopifyResult?.steps.find((s) => s.step === "theme")?.status === "succeeded";
  const steps = nextSteps(path, { themePushed });
  const name = view.project.content?.settings.storeName || view.project.name;
  return (
    <Card className="animate-fade-up border-ember/40 bg-gradient-to-br from-accent/60 via-card to-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <PartyPopperIcon className="size-6 text-ember" aria-hidden="true" />
          {path === "push" ? `${name} is in Shopify` : `${name} is ready to import`}
          {view.preflight.ok ? null : (
            <span className="sr-only">, with {view.preflight.failed} checklist items to fix</span>
          )}
        </CardTitle>
        <CardDescription>
          {path === "push"
            ? `Everything was pushed to ${push!.storeDomain} as drafts. Work through these steps to launch.`
            : "Your bundle has everything Shopify needs. Work through these steps to launch."}
          {view.preflight.ok
            ? ""
            : ` First fix ${view.preflight.failed === 1 ? "the item" : `the ${view.preflight.failed} items`} marked ✕ in the pre-flight checklist below.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="flex flex-wrap gap-2" aria-label="Pre-flight summary">
          {view.preflight.items.map((i) => (
            <Badge
              key={i.id}
              variant={
                i.status === "pass" ? "success" : i.status === "fail" ? "destructive" : "warning"
              }
            >
              {i.status === "pass" ? "✓" : i.status === "fail" ? "✕" : "!"} {i.label}
            </Badge>
          ))}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Next steps in Shopify</h3>
          <ol className="grid gap-2">
            {steps.map((s, k) => (
              <li key={s.title} className="flex gap-3 rounded-lg border bg-background p-3 text-sm">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-ember/12 text-xs font-semibold"
                  aria-hidden="true"
                >
                  {k + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-muted-foreground">{s.body}</p>
                </div>
                {store && s.admin ? (
                  <a
                    href={`https://admin.shopify.com/store/${store}/${s.admin}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 self-start rounded-sm text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Open <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">{s.title} in Shopify (opens in a new tab)</span>
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
