"use client";
import {
  AlertOctagonIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
  InfoIcon,
  Loader2Icon,
  ScanSearchIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { ProductAnalysis, RiskFlag, SourceExtraction } from "@/lib/schemas";
import { cn, formatMoney } from "@/lib/utils";
import { assetUrl } from "../dropzone";
import { useActiveJob, useJobRunning, usePatchProject, useStartJob, useWizard } from "../context";
import { EditableList, EditableText } from "../editable";
import { Field } from "../field";
import { EmptyState, StepShell } from "../step-shell";

const SEVERITY = {
  block: {
    label: "Must fix",
    icon: AlertOctagonIcon,
    badge: "destructive" as const,
    ring: "border-destructive/40",
  },
  warn: {
    label: "Check",
    icon: AlertTriangleIcon,
    badge: "warning" as const,
    ring: "border-warning/50",
  },
  info: { label: "Info", icon: InfoIcon, badge: "secondary" as const, ring: "border-border" },
};

function RiskPanel({ analysis }: { analysis: ProductAnalysis }) {
  const patch = usePatchProject({ silent: true });
  const flags = analysis.riskFlags;
  const openBlocks = flags.filter((f) => f.severity === "block" && !f.acknowledged).length;
  const setAck = (flag: RiskFlag, acknowledged: boolean) =>
    patch.mutate({
      analysis: {
        ...analysis,
        riskFlags: flags.map((f) => (f.id === flag.id ? { ...f, acknowledged } : f)),
      },
    });

  return (
    <Card className={cn(openBlocks > 0 && "border-destructive/40")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlertIcon className="size-5" aria-hidden="true" /> Risk flags
        </CardTitle>
        <CardDescription>
          {flags.length === 0
            ? "Nothing flagged. You're still responsible for checking your product is legal to sell in your market."
            : openBlocks > 0
              ? `${openBlocks} must-fix flag${openBlocks === 1 ? "" : "s"} must be resolved or acknowledged before you can export.`
              : "Review each flag. Must-fix flags have been acknowledged."}
        </CardDescription>
      </CardHeader>
      {flags.length > 0 && (
        <CardContent>
          <ul className="grid gap-3">
            {flags.map((f) => {
              const s = SEVERITY[f.severity];
              const Icon = s.icon;
              const id = `ack-${f.id}`;
              return (
                <li
                  key={f.id}
                  className={cn(
                    "grid gap-2 rounded-lg border p-3",
                    s.ring,
                    f.acknowledged && "opacity-75",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.badge}>
                      <Icon className="size-3" aria-hidden="true" /> {s.label}
                    </Badge>
                    <Badge variant="outline">{f.category.replace(/_/g, " ")}</Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {f.source === "rules" ? "automatic check" : "AI review"}
                    </span>
                  </div>
                  <p className="text-sm">{f.message}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Fix: </span>
                    {f.suggestedFix}
                  </p>
                  {f.severity !== "info" && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={f.acknowledged}
                        onCheckedChange={(v) => setAck(f, v === true)}
                      />
                      <label htmlFor={id} className="text-sm">
                        {f.severity === "block" ? "I've fixed this or accept the risk" : "Reviewed"}
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function SourceCard({
  e,
  index,
  onChange,
}: {
  e: SourceExtraction;
  index: number;
  onChange: (e: SourceExtraction) => void;
}) {
  const specs = Object.entries(e.specs);
  const blocking = e.warnings.filter((w) =>
    ["captcha", "anti_bot", "login_wall", "robots_disallowed", "blocked_url"].includes(w.code),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <GlobeIcon className="size-4" aria-hidden="true" />
          {e.sourceDomain || new URL(e.url).hostname}
          <Badge variant="outline">{index === 0 ? "Primary source" : "Reference"}</Badge>
          <Badge variant="secondary">
            {e.fetchMethod === "none" ? "not read" : `read via ${e.adapter ?? e.fetchMethod}`}
          </Badge>
        </CardTitle>
        <CardDescription>
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 break-all underline-offset-4 hover:underline"
          >
            {e.url} <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {e.warnings.map((w) => (
          <Alert key={w.code} variant={blocking.includes(w) ? "destructive" : "warning"}>
            <AlertTriangleIcon />
            <AlertDescription>{w.message}</AlertDescription>
          </Alert>
        ))}
        {e.fetchMethod !== "none" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field id={`src-title-${index}`} label="Title">
              <EditableText
                id={`src-title-${index}`}
                key={e.title ?? ""}
                value={e.title ?? ""}
                onCommit={(v) => onChange({ ...e, title: v || null })}
              />
            </Field>
            <Field
              id={`src-price-${index}`}
              label="Price"
              help={e.price ? formatMoney(e.price.amount, e.price.currency) : "Not found"}
            >
              <EditableText
                id={`src-price-${index}`}
                key={`${e.price?.amount}`}
                value={e.price ? String(e.price.amount) : ""}
                placeholder="e.g. 34.00"
                onCommit={(v) => {
                  const n = Number(v.replace(/[^\d.]/g, ""));
                  onChange({
                    ...e,
                    price:
                      v.trim() && Number.isFinite(n)
                        ? { amount: n, currency: e.price?.currency ?? "USD" }
                        : null,
                  });
                }}
              />
            </Field>
            <Field id={`src-desc-${index}`} label="Description text" className="md:col-span-2">
              <EditableText
                id={`src-desc-${index}`}
                key={e.description ?? ""}
                multiline
                rows={4}
                value={e.description ?? ""}
                onCommit={(v) => onChange({ ...e, description: v || null })}
              />
            </Field>
          </div>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {e.brand && (
            <>
              <dt className="text-muted-foreground">Brand on source</dt>
              <dd>{e.brand}</dd>
            </>
          )}
          {e.sku && (
            <>
              <dt className="text-muted-foreground">SKU</dt>
              <dd>{e.sku}</dd>
            </>
          )}
          {e.availability && (
            <>
              <dt className="text-muted-foreground">Availability</dt>
              <dd>{e.availability.replace(/^https?:\/\/schema\.org\//, "")}</dd>
            </>
          )}
          {e.rating && (
            <>
              <dt className="text-muted-foreground">Rating on source</dt>
              <dd>
                {e.rating.value}
                {e.rating.count ? ` from ${e.rating.count} reviews` : ""}{" "}
                <span className="text-muted-foreground">(not reused in your store)</span>
              </dd>
            </>
          )}
          {e.shippingInfo && (
            <>
              <dt className="text-muted-foreground">Shipping</dt>
              <dd>{e.shippingInfo}</dd>
            </>
          )}
          {e.language && (
            <>
              <dt className="text-muted-foreground">Page language</dt>
              <dd>{e.language}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Image candidates</dt>
          <dd>{e.images.length}</dd>
        </dl>
        {e.options.length > 0 && (
          <div className="grid gap-1 text-sm">
            <h3 className="font-medium">Options found</h3>
            <ul className="flex flex-wrap gap-2">
              {e.options.map((o) => (
                <li key={o.name} className="rounded-md border px-2 py-1">
                  <span className="font-medium">{o.name}:</span> {o.values.join(", ")}
                </li>
              ))}
            </ul>
            {e.variants.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {e.variants.length} variants on the source page
              </p>
            )}
          </div>
        )}
        {specs.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="mb-1 text-left font-medium">Specifications</caption>
              <tbody>
                {specs.map(([k, v]) => (
                  <tr key={k} className="border-t">
                    <th
                      scope="row"
                      className="w-1/3 py-1.5 pr-3 text-left font-normal text-muted-foreground"
                    >
                      {k}
                    </th>
                    <td className="py-1.5">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysisCard({ analysis }: { analysis: ProductAnalysis }) {
  const patch = usePatchProject({ silent: true });
  const set = (p: Partial<ProductAnalysis>) => patch.mutate({ analysis: { ...analysis, ...p } });
  const lists: [keyof ProductAnalysis, string][] = [
    ["materials", "Materials"],
    ["colors", "Colours"],
    ["useCases", "Use cases"],
    ["audience", "Audience"],
    ["differentiators", "Key differentiators"],
    ["detectedText", "Text or logos visible on the product"],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-5" aria-hidden="true" /> What the AI sees
        </CardTitle>
        <CardDescription>
          Edit anything that&apos;s wrong; later steps use these facts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {!analysis.isProduct && (
          <Alert variant="warning" className="md:col-span-2">
            <AlertTriangleIcon />
            <AlertTitle>This doesn&apos;t look like a single product</AlertTitle>
            <AlertDescription>
              Check the URL is a product page, or upload photos of the product, then re-run the
              analysis.
            </AlertDescription>
          </Alert>
        )}
        <Field id="an-name" label="Product">
          <EditableText
            id="an-name"
            key={analysis.productName}
            value={analysis.productName}
            onCommit={(v) => set({ productName: v })}
          />
        </Field>
        <Field id="an-type" label="Product type">
          <EditableText
            id="an-type"
            key={analysis.productType}
            value={analysis.productType}
            onCommit={(v) => set({ productType: v })}
          />
        </Field>
        <Field id="an-summary" label="Summary" className="md:col-span-2">
          <EditableText
            id="an-summary"
            key={analysis.summary}
            multiline
            value={analysis.summary}
            onCommit={(v) => set({ summary: v })}
          />
        </Field>
        {lists.map(([key, label]) => (
          <Field key={key} id={`an-${key}`} label={label} help="One per line">
            <EditableList
              id={`an-${key}`}
              value={analysis[key] as string[]}
              onCommit={(v) => set({ [key]: v } as Partial<ProductAnalysis>)}
            />
          </Field>
        ))}
        {analysis.imageIssues.length > 0 && (
          <div className="md:col-span-2">
            <h3 className="text-sm font-medium">Photo set notes</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
              {analysis.imageIssues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalysisStep() {
  const { view, projectId } = useWizard();
  const start = useStartJob();
  const patch = usePatchProject({ silent: true });
  const running = useJobRunning(["analyze", "extract", "pipeline"]);
  const job = useActiveJob(["analyze", "extract", "pipeline"]);
  const { analysis, extractions } = view.project;
  const assets = view.assets.filter((a) => !a.discarded).sort((a, b) => a.position - b.position);
  const run = () => start.mutate({ path: "analyze" });

  return (
    <StepShell
      step="analysis"
      jobTypes={["analyze", "extract"]}
      description="What we read from your links and photos, what the AI sees in the product, and anything risky to fix before you sell it."
      onRegenerate={run}
      onRetry={run}
      regenerating={running}
      actions={
        <>
          {view.project.inputs.urls.length > 0 && (
            <Button
              variant="outline"
              disabled={running}
              onClick={() => start.mutate({ path: "extract", body: { force: true } })}
            >
              <GlobeIcon /> Re-read links
            </Button>
          )}
          <Button variant="ember" onClick={run} disabled={running}>
            {running ? <Loader2Icon className="animate-spin" /> : <ScanSearchIcon />}
            {analysis ? "Re-run analysis" : "Analyze product"}
          </Button>
        </>
      }
    >
      {job && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" /> {job.message}
        </p>
      )}

      {analysis ? (
        <>
          <RiskPanel analysis={analysis} />
          <AnalysisCard analysis={analysis} />
        </>
      ) : !running ? (
        <EmptyState icon={ScanSearchIcon} title="Not analysed yet">
          Run the analysis to read your links, look at your photos and check for risks.
        </EmptyState>
      ) : (
        <div className="grid gap-3" aria-hidden="true">
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
          <div className="h-56 animate-pulse rounded-xl bg-muted" />
        </div>
      )}

      {extractions.length > 0 && (
        <section aria-labelledby="sources-title" className="grid gap-3">
          <h2 id="sources-title" className="font-display text-2xl">
            Extracted from your links
          </h2>
          {extractions.map((e, i) => (
            <SourceCard
              key={e.url}
              e={e}
              index={i}
              onChange={(next) =>
                patch.mutate({ extractions: extractions.map((x, j) => (j === i ? next : x)) })
              }
            />
          ))}
        </section>
      )}

      {assets.length > 0 && (
        <section aria-labelledby="images-title" className="grid gap-3">
          <h2 id="images-title" className="font-display text-2xl">
            Image candidates
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {assets.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-lg border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetUrl(projectId, a)}
                  alt={a.altText || "Product image"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                <div className="grid gap-1 p-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {a.role && <Badge variant="outline">{a.role}</Badge>}
                    {a.origin === "scraped" && <Badge variant="warning">third party</Badge>}
                    {a.flags
                      .filter((f) => ["watermark", "text_overlay", "not_product"].includes(f.code))
                      .map((f) => (
                        <Badge key={f.code} variant="destructive">
                          {f.code.replace(/_/g, " ")}
                        </Badge>
                      ))}
                  </div>
                  <p className="text-muted-foreground">{a.altText || "No alt text yet"}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis && analysis.riskFlags.every((f) => f.severity !== "block" || f.acknowledged) && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2Icon className="size-4" aria-hidden="true" /> No unresolved must-fix flags.
        </p>
      )}
    </StepShell>
  );
}
