"use client";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileArchiveIcon,
  Loader2Icon,
  PackageIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExportView } from "@/lib/db/exports";
import type { BundleOptions } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useActiveJob, useJobRunning, useStartJob, useWizard } from "../context";
import { EmptyState, StepShell } from "../step-shell";
import { PreflightCard, StoreReadyCard, SupplierDisclaimer } from "./preflight";
import { ShopifyPushCard } from "./shopify-push";

const EXPORT_JOBS = ["export_bundle"];

function Choice<T extends string>({
  name,
  value,
  current,
  onChange,
  title,
  children,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (v: T) => void;
  title: string;
  children: React.ReactNode;
}) {
  const id = `${name}-${value}`;
  const checked = value === current;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-ember bg-accent/40" : "hover:bg-muted/50",
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 size-4 accent-ember"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

function BundleCard() {
  const { caps } = useWizard();
  const start = useStartJob();
  const running = useJobRunning(EXPORT_JOBS);
  const job = useActiveJob(EXPORT_JOBS);
  const [opts, setOpts] = useState<BundleOptions>({
    imageMode: "upload_after",
    csvFormat: "current",
  });
  const publicBase = caps.publicImageBaseUrl ?? caps.appBaseUrl;
  const unreachable =
    opts.imageMode === "public_url" && !caps.publicImageBaseUrl && caps.appBaseUrlIsLocal;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileArchiveIcon className="size-5" aria-hidden="true" /> Download bundle (ZIP)
        </CardTitle>
        <CardDescription>
          Product CSV, images, pages, policies, collections, menus, Dawn theme files, brand kit and
          a step-by-step import guide.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Product images</legend>
          <div className="grid gap-2 md:grid-cols-2">
            <Choice
              name="image-mode"
              value="upload_after"
              current={opts.imageMode}
              onChange={(imageMode) => setOpts((o) => ({ ...o, imageMode }))}
              title="Upload images after import"
            >
              The CSV has no image links. You upload the photos in Shopify using the included
              mapping file. Works everywhere.
            </Choice>
            <Choice
              name="image-mode"
              value="public_url"
              current={opts.imageMode}
              onChange={(imageMode) => setOpts((o) => ({ ...o, imageMode }))}
              title="Public URL mode"
            >
              The CSV links to images at {publicBase}
              {caps.publicImageBaseUrl ? "" : " (token-protected links that expire after 24 hours)"}
              . Shopify downloads them during import.
            </Choice>
          </div>
        </fieldset>
        {unreachable ? (
          <Alert variant="warning">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertTitle>Shopify can&apos;t reach this computer</AlertTitle>
            <AlertDescription>
              The app runs at {caps.appBaseUrl}, so image links won&apos;t work from Shopify. Deploy
              the app or expose it with a tunnel (and set APP_BASE_URL), set PUBLIC_IMAGE_BASE_URL
              to where you host the images, or upload images after import. Pushing straight to
              Shopify is the most reliable way to get images in.
            </AlertDescription>
          </Alert>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">CSV column names</legend>
          <div className="grid gap-2 md:grid-cols-2">
            <Choice
              name="csv-format"
              value="current"
              current={opts.csvFormat}
              onChange={(csvFormat) => setOpts((o) => ({ ...o, csvFormat }))}
              title="Current Shopify template"
            >
              &quot;URL handle&quot;, &quot;Description&quot;, &quot;Price&quot;… as in
              Shopify&apos;s template today.
            </Choice>
            <Choice
              name="csv-format"
              value="legacy"
              current={opts.csvFormat}
              onChange={(csvFormat) => setOpts((o) => ({ ...o, csvFormat }))}
              title="Classic template"
            >
              &quot;Handle&quot;, &quot;Body (HTML)&quot;, &quot;Variant Price&quot;… Try this if
              Shopify asks you to choose column headings.
            </Choice>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ember"
            disabled={running || start.isPending}
            onClick={() => start.mutate({ path: "export/bundle", body: opts })}
          >
            {running ? <Loader2Icon className="animate-spin" /> : <PackageIcon />}
            Build bundle
          </Button>
          {job ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {job.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportDetails({ exp }: { exp: ExportView }) {
  const r = exp.validationReport;
  if (!r) return null;
  const errors = r.issues.filter((i) => i.level === "error");
  const warnings = r.issues.filter((i) => i.level === "warning");
  return (
    <details className="group rounded-md border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Validation report: {r.checks.filter((c) => c.passed).length}/{r.checks.length} checks passed
        {errors.length ? `, ${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}
        {warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}
      </summary>
      <ul className="mt-3 grid gap-1">
        {r.checks.map((c) => (
          <li key={c.name} className="flex items-start gap-2">
            {c.passed ? (
              <CheckCircle2Icon
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-label="Passed"
              />
            ) : (
              <XCircleIcon
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-label="Failed"
              />
            )}
            <span>
              <span className="font-medium">{c.name}</span>: {c.detail}
            </span>
          </li>
        ))}
      </ul>
      {r.issues.length ? (
        <ul className="mt-3 grid gap-1 text-xs">
          {r.issues.slice(0, 50).map((i, k) => (
            <li
              key={k}
              className={i.level === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {i.level === "error" ? "Error" : "Warning"}
              {i.row ? ` (line ${i.row})` : ""}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {r.theme && !r.theme.ok ? (
        <ul className="mt-3 grid gap-1 text-xs text-destructive">
          {r.theme.issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function ExportsCard({ exports }: { exports: ExportView[] }) {
  const bundles = exports.filter((e) => e.type === "bundle");
  if (!bundles.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your bundles</CardTitle>
        <CardDescription>
          Newest first. Each one is a full snapshot of the store at that time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {bundles.map((e, i) => {
          const r = e.validationReport;
          return (
            <div key={e.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid min-w-0 gap-0.5">
                  <p className="truncate text-sm font-medium">{e.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()} ·{" "}
                    {e.options?.imageMode === "public_url"
                      ? "public image links"
                      : "upload images after import"}{" "}
                    · {e.options?.csvFormat === "legacy" ? "classic CSV" : "current CSV"}
                    {e.publicExpiresAt
                      ? ` · links expire ${new Date(e.publicExpiresAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i === 0 ? <Badge variant="outline">Latest</Badge> : null}
                  {r ? (
                    <Badge variant={r.ok ? "success" : "destructive"}>
                      {r.ok ? "Valid" : "Needs fixes"}
                    </Badge>
                  ) : null}
                  <Button asChild size="sm" variant={i === 0 ? "default" : "outline"}>
                    <a href={`/api/exports/${e.id}/download`} download>
                      <DownloadIcon /> Download
                    </a>
                  </Button>
                </div>
              </div>
              <ReportDetails exp={e} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CopyCard() {
  const { view, projectId } = useWizard();
  const { listing, content } = view.project;
  const copy = async (label: string, text: string | (() => Promise<string>)) => {
    try {
      const value = typeof text === "string" ? text : await text();
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(
        `Couldn't copy the ${label.toLowerCase()}. Your browser may block clipboard access.`,
      );
    }
  };
  if (!listing) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCopyIcon className="size-5" aria-hidden="true" /> Copy individual pieces
        </CardTitle>
        <CardDescription>Paste straight into the Shopify admin.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy("Description HTML", listing.descriptionHtml)}
        >
          Description HTML
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            copy("Product CSV", async () => {
              const res = await fetch(`/api/projects/${projectId}/export/csv`);
              if (!res.ok) throw new Error("csv");
              return res.text();
            })
          }
        >
          Product CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy("Product JSON", JSON.stringify(listing, null, 2))}
        >
          Product JSON
        </Button>
        {content ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy("Store content JSON", JSON.stringify(content, null, 2))}
          >
            Store content JSON
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ExportStep() {
  const { view } = useWizard();
  const { listing, content } = view.project;
  const ready = Boolean(listing && content);
  return (
    <StepShell
      step="export"
      jobTypes={EXPORT_JOBS}
      description="Download everything as a ZIP for Shopify's importers, push straight to your store, or copy individual pieces."
    >
      {ready ? (
        <>
          <StoreReadyCard />
          <PreflightCard />
          <SupplierDisclaimer />
          <BundleCard />
          <ExportsCard exports={view.exports} />
          <ShopifyPushCard />
          <CopyCard />
        </>
      ) : (
        <EmptyState icon={PackageIcon} title="Nothing to export yet">
          Finish the product listing and store content first, or use Generate everything.
        </EmptyState>
      )}
    </StepShell>
  );
}
