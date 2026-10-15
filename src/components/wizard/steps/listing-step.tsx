"use client";
import {
  AlertTriangleIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { COMPARE_AT_WARNING, suggestPrice, type PricingInputs } from "@/lib/listing/pricing";
import { SIMILARITY_THRESHOLD } from "@/lib/listing/similarity";
import { buildMatrix, skuPrefix, validateVariants, variantValues } from "@/lib/listing/variants";
import {
  TONES,
  type ListingMeta,
  type ProductListing,
  type ProductOption,
  type ProductVariant,
} from "@/lib/schemas";
import { cn, formatMoney } from "@/lib/utils";
import { useActiveJob, useJobRunning, usePatchProject, useStartJob, useWizard } from "../context";
import { EditableText } from "../editable";
import { Field } from "../field";
import { EmptyState, StepShell } from "../step-shell";

const LISTING_JOBS = ["listing", "seo", "regenerate", "pipeline"];
const PAGE_SIZE = 50;

type Save = (listing: ProductListing, meta?: ListingMeta) => void;

function Counter({ value, max, min }: { value: string; max: number; min?: number }) {
  const n = value.length;
  const bad = n > max || (min != null && n > 0 && n < min);
  return (
    <span className={cn("tabular-nums", bad ? "text-destructive" : "text-muted-foreground")}>
      {n}/{max}
      {min != null ? ` (aim for ${min}+)` : ""}
    </span>
  );
}

/** Regenerate / Make shorter / Change tone for one listing field. */
function FieldActions({ field, label }: { field: string; label: string }) {
  const start = useStartJob();
  const busy = useJobRunning(LISTING_JOBS) || start.isPending;
  const run = (operation: "regenerate" | "shorten" | "change_tone", tone?: string) =>
    start.mutate({
      path: "regenerate",
      body: { section: "listing_field", field, operation, ...(tone ? { tone } : {}) },
    });
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={`${label} AI actions`}
    >
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => run("regenerate")}>
        <RefreshCwIcon /> Regenerate
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => run("shorten")}>
        <ScissorsIcon /> Make shorter
      </Button>
      <Select value="" onValueChange={(tone) => run("change_tone", tone)} disabled={busy}>
        <SelectTrigger className="h-7 w-auto gap-1 text-xs" aria-label={`Change tone of ${label}`}>
          <SelectValue placeholder="Change tone" />
        </SelectTrigger>
        <SelectContent>
          {TONES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReviewCard({ meta }: { meta: ListingMeta }) {
  const flagged = meta.similarity.filter((f) => f.score > SIMILARITY_THRESHOLD);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5" aria-hidden="true" /> Before you publish
        </CardTitle>
        <CardDescription>
          Placeholders mark facts the source didn&apos;t state. Fill them in or delete them.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="font-medium">
            {meta.confirmMarkers.length
              ? `${meta.confirmMarkers.length} thing${meta.confirmMarkers.length === 1 ? "" : "s"} to confirm`
              : "Nothing left to confirm"}
          </p>
          {meta.confirmMarkers.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {meta.confirmMarkers.map((m) => (
                <li key={m}>
                  <Badge variant="warning">{m}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <p className="font-medium">Originality check</p>
          {meta.similarity.length === 0 ? (
            <p className="text-muted-foreground">No source text to compare against.</p>
          ) : (
            <p className="text-muted-foreground">
              Each section was compared with the source page (shared 5-word phrases).{" "}
              {flagged.length
                ? `${flagged.length} section${flagged.length === 1 ? " was" : "s were"} above ${SIMILARITY_THRESHOLD * 100}% and rewritten: `
                : `All sections are under ${SIMILARITY_THRESHOLD * 100}%.`}
              {flagged
                .map(
                  (f) =>
                    `${f.section} ${Math.round(f.score * 100)}% → ${Math.round(f.finalScore * 100)}%`,
                )
                .join(", ")}
            </p>
          )}
          {meta.similarity.some((f) => f.finalScore > SIMILARITY_THRESHOLD) ? (
            <p className="text-destructive">
              Some wording still matches the source closely. Rewrite it in your own words.
            </p>
          ) : null}
        </div>
        {meta.guardrailViolations.length ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Wording to remove</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {meta.guardrailViolations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {meta.warnings.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-muted-foreground">
            {meta.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {w}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BasicsCard({ listing, save }: { listing: ProductListing; save: Save }) {
  const [tagDraft, setTagDraft] = useState(listing.tags.join(", "));
  const tags = tagDraft
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Product details</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="l-title" className="text-sm font-medium">
              Title
            </label>
            <FieldActions field="title" label="Title" />
          </div>
          <EditableText
            key={listing.title}
            id="l-title"
            value={listing.title}
            maxLength={70}
            aria-describedby="l-title-help"
            onCommit={(v) => v.trim() && save({ ...listing, title: v.trim() })}
          />
          <p id="l-title-help" className="text-xs">
            <Counter value={listing.title} max={70} />
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id="l-vendor" label="Vendor" help="Your brand name">
            <EditableText
              key={listing.vendor}
              id="l-vendor"
              value={listing.vendor}
              onCommit={(v) => save({ ...listing, vendor: v.trim() })}
            />
          </Field>
          <Field id="l-type" label="Product type">
            <EditableText
              key={listing.productType}
              id="l-type"
              value={listing.productType}
              onCommit={(v) => save({ ...listing, productType: v.trim() })}
            />
          </Field>
          <Field
            id="l-category"
            label="Shopify product category"
            help="Suggested Standard Product Taxonomy path; confirm it in the Shopify admin."
            className="sm:col-span-2"
          >
            <EditableText
              key={listing.shopifyCategory}
              id="l-category"
              value={listing.shopifyCategory}
              aria-describedby="l-category-help"
              placeholder="e.g. Home & Garden > Kitchen & Dining > …"
              onCommit={(v) => save({ ...listing, shopifyCategory: v.trim() })}
            />
          </Field>
          <Field
            id="l-tags"
            label="Tags"
            help={`${tags.length}/13, comma separated`}
            error={
              tags.length > 13 ? "Shopify search works best with 13 tags or fewer." : undefined
            }
            className="sm:col-span-2"
          >
            <Input
              id="l-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => {
                const next = [...new Set(tags)].slice(0, 13);
                setTagDraft(next.join(", "));
                if (next.join() !== listing.tags.join()) save({ ...listing, tags: next });
              }}
              aria-describedby="l-tags-help"
            />
          </Field>
          <Field id="l-handle" label="URL handle" help="/products/your-handle">
            <EditableText
              key={listing.handle}
              id="l-handle"
              value={listing.handle}
              onCommit={(v) => {
                const h = v
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "");
                if (h) save({ ...listing, handle: h });
              }}
            />
          </Field>
          <Field
            id="l-status"
            label="Status on import"
            help="Draft keeps it hidden until you publish."
          >
            <Select
              value={listing.status}
              onValueChange={(v) => save({ ...listing, status: v as ProductListing["status"] })}
            >
              <SelectTrigger id="l-status" aria-describedby="l-status-help">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function highlightConfirm(html: string) {
  // The HTML was sanitized server-side; placeholders contain no markup.
  return html.replace(/\[CONFIRM:[^\]<]*\]/g, (m) => `<mark class="confirm-mark">${m}</mark>`);
}

function DescriptionCard({ listing, save }: { listing: ProductListing; save: Save }) {
  const [draft, setDraft] = useState(listing.descriptionHtml);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <CardTitle>Description</CardTitle>
          <CardDescription>Clean HTML with only Shopify-safe tags.</CardDescription>
        </div>
        <FieldActions field="descriptionHtml" label="Description" />
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="html">Edit HTML</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <div
              className="prose-store mt-3 rounded-lg border bg-background p-4"
              dangerouslySetInnerHTML={{ __html: highlightConfirm(listing.descriptionHtml) }}
            />
          </TabsContent>
          <TabsContent value="html">
            <Textarea
              aria-label="Description HTML"
              className="mt-3 min-h-80 font-mono text-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== listing.descriptionHtml) save({ ...listing, descriptionHtml: draft });
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Saved when you leave the field. Unsupported tags and attributes are removed.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SeoCard({ listing, save }: { listing: ProductListing; save: Save }) {
  const start = useStartJob();
  const busy = useJobRunning(LISTING_JOBS) || start.isPending;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <CardTitle className="flex items-center gap-2">
            <SearchIcon className="size-5" aria-hidden="true" /> Search engine listing
          </CardTitle>
          <CardDescription>Lengths are enforced: title ≤ 60, description ≤ 155.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => start.mutate({ path: "regenerate", body: { section: "seo" } })}
        >
          <SparklesIcon /> Re-run SEO pass
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="rounded-lg border bg-background p-4" aria-label="Search result preview">
          <p className="truncate text-xs text-muted-foreground">
            yourstore.com › products › {listing.handle}
          </p>
          <p className="truncate text-lg text-[#1a0dab] dark:text-[#8ab4f8]">{listing.seoTitle}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{listing.seoDescription}</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="l-seo-title" className="text-sm font-medium">
              SEO title
            </label>
            <FieldActions field="seoTitle" label="SEO title" />
          </div>
          <EditableText
            key={listing.seoTitle}
            id="l-seo-title"
            value={listing.seoTitle}
            maxLength={60}
            onCommit={(v) => save({ ...listing, seoTitle: v.trim() })}
          />
          <p className="text-xs">
            <Counter value={listing.seoTitle} max={60} />
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="l-seo-desc" className="text-sm font-medium">
              Meta description
            </label>
            <FieldActions field="seoDescription" label="Meta description" />
          </div>
          <EditableText
            key={listing.seoDescription}
            id="l-seo-desc"
            multiline
            rows={3}
            value={listing.seoDescription}
            maxLength={155}
            onCommit={(v) => save({ ...listing, seoDescription: v.trim() })}
          />
          <p className="text-xs">
            <Counter value={listing.seoDescription} max={155} min={120} />
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  help,
  suffix,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  help?: string;
  suffix?: string;
}) {
  return (
    <Field id={id} label={label} help={help}>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value ?? ""}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={suffix ? "pr-8" : undefined}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function PricingCard({
  listing,
  meta,
  defaults,
  save,
}: {
  listing: ProductListing;
  meta: ListingMeta;
  defaults: PricingInputs;
  save: Save;
}) {
  const [inputs, setInputs] = useState<PricingInputs>(defaults);
  const s = useMemo(() => suggestPrice(inputs), [inputs]);
  const $ = (n: number) => formatMoney(n, inputs.currency);
  const set = (k: keyof PricingInputs) => (v: number | null) =>
    setInputs((i) => ({ ...i, [k]: v }));
  const apply = (next: PricingInputs) => {
    const sug = suggestPrice(next);
    save(
      {
        ...listing,
        variants: listing.variants.map((v) => ({
          ...v,
          price: sug.suggestedPrice > 0 ? sug.suggestedPrice : v.price,
          costPerItem: next.unitCost,
          compareAtPrice: next.compareAtEnabled ? sug.compareAtPrice : null,
        })),
      },
      { ...meta, pricing: sug, compareAtEnabled: next.compareAtEnabled },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalculatorIcon className="size-5" aria-hidden="true" /> Pricing assistant
        </CardTitle>
        <CardDescription>
          Based on your cost, target margin and the market price we found. The math is shown so you
          can check it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="p-cost"
            label="Unit cost"
            value={inputs.unitCost}
            onChange={set("unitCost")}
            help="Product + inbound shipping"
          />
          <NumberField
            id="p-margin"
            label="Target margin"
            value={inputs.targetMarginPct}
            onChange={set("targetMarginPct")}
            suffix="%"
          />
          <NumberField
            id="p-target"
            label="Target price"
            value={inputs.targetPrice}
            onChange={set("targetPrice")}
            help="Overrides the margin"
          />
          <NumberField
            id="p-market"
            label="Market price"
            value={inputs.competitorPrice}
            onChange={set("competitorPrice")}
            help={inputs.competitorSource || "A competitor's price"}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-muted/60 p-4 text-sm">
          <p className="text-base">
            Suggested price:{" "}
            <strong className="font-semibold">
              {s.suggestedPrice > 0 ? $(s.suggestedPrice) : "—"}
            </strong>
            {s.marginPct != null ? (
              <span className="text-muted-foreground"> · {s.marginPct}% margin</span>
            ) : null}
          </p>
          {s.steps.length ? (
            <ol className="list-decimal grid gap-0.5 pl-5 text-muted-foreground">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {s.warnings
            .filter((w) => w !== COMPARE_AT_WARNING)
            .map((w) => (
              <p
                key={w}
                className="flex gap-1.5 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]"
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {w}
              </p>
            ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="p-compare" className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-sm">
              <span className="font-medium">Show a compare-at (&quot;was&quot;) price</span>
              <span className="text-xs text-muted-foreground">Off by default.</span>
            </label>
            <Switch
              id="p-compare"
              checked={inputs.compareAtEnabled}
              onCheckedChange={(on) => {
                const next = { ...inputs, compareAtEnabled: on };
                setInputs(next);
                if (!on) apply(next);
              }}
            />
          </div>
          {inputs.compareAtEnabled ? (
            <>
              <Alert variant="warning">
                <AlertTriangleIcon />
                <AlertTitle>Deceptive pricing is illegal in many markets</AlertTitle>
                <AlertDescription>{COMPARE_AT_WARNING}</AlertDescription>
              </Alert>
              <div className="max-w-xs">
                <NumberField
                  id="p-regular"
                  label="Your regular price"
                  value={inputs.regularPrice}
                  onChange={set("regularPrice")}
                  help="The price you have actually charged"
                />
              </div>
            </>
          ) : null}
        </div>
        <div>
          <Button onClick={() => apply(inputs)} disabled={!(s.suggestedPrice > 0)}>
            Apply to all {listing.variants.length} variant{listing.variants.length === 1 ? "" : "s"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionsEditor({
  listing,
  meta,
  save,
}: {
  listing: ProductListing;
  meta: ListingMeta;
  save: Save;
}) {
  const [draft, setDraft] = useState(
    listing.options.map((o) => ({ name: o.name, values: o.values.join(", ") })),
  );
  const [notes, setNotes] = useState<string[]>([]);
  const parsed: ProductOption[] = draft.map((d) => ({
    name: d.name,
    values: d.values
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  }));
  const rebuild = () => {
    const first = listing.variants[0];
    const m = buildMatrix(
      parsed,
      {
        price: meta.pricing?.suggestedPrice || first?.price || 0,
        skuPrefix: skuPrefix(listing.vendor, listing.productType),
        grams: first?.grams ?? 0,
        costPerItem: first?.costPerItem ?? null,
        compareAtPrice: meta.compareAtEnabled ? (first?.compareAtPrice ?? null) : null,
      },
      listing.variants,
    );
    setNotes(m.warnings);
    setDraft(m.options.map((o) => ({ name: o.name, values: o.values.join(", ") })));
    save({ ...listing, options: m.options, variants: m.variants });
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {draft.map((d, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end"
        >
          <Field id={`opt-name-${i}`} label={`Option ${i + 1}`}>
            <Input
              id={`opt-name-${i}`}
              value={d.name}
              onChange={(e) =>
                setDraft((x) => x.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)))
              }
            />
          </Field>
          <Field id={`opt-values-${i}`} label="Values (comma separated)">
            <Input
              id={`opt-values-${i}`}
              value={d.values}
              onChange={(e) =>
                setDraft((x) => x.map((o, j) => (j === i ? { ...o, values: e.target.value } : o)))
              }
            />
          </Field>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove option ${d.name || i + 1}`}
            disabled={draft.length === 1}
            onClick={() => setDraft((x) => x.filter((_, j) => j !== i))}
          >
            <MinusIcon />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={draft.length >= 3}
          onClick={() => setDraft((x) => [...x, { name: "", values: "" }])}
        >
          <PlusIcon /> Add option
        </Button>
        <Button size="sm" onClick={rebuild}>
          <RefreshCwIcon /> Rebuild variants
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          Up to 3 options and 2,048 variants. Existing variant edits are kept.
        </span>
      </div>
      {notes.map((n) => (
        <p
          key={n}
          className="text-sm text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]"
        >
          {n}
        </p>
      ))}
    </div>
  );
}

type NumKey = "price" | "compareAtPrice" | "costPerItem" | "grams" | "inventoryQty";

function VariantsCard({
  listing,
  meta,
  save,
}: {
  listing: ProductListing;
  meta: ListingMeta;
  save: Save;
}) {
  const [page, setPage] = useState(0);
  const errors = useMemo(
    () => validateVariants(listing.options, listing.variants),
    [listing.options, listing.variants],
  );
  const pages = Math.ceil(listing.variants.length / PAGE_SIZE);
  const rows = listing.variants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const update = (index: number, patch: Partial<ProductVariant>) =>
    save({
      ...listing,
      variants: listing.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    });
  const numCell = (index: number, v: ProductVariant, key: NumKey, label: string, int = false) => (
    <input
      key={`${key}-${v[key] ?? ""}`}
      type="number"
      inputMode={int ? "numeric" : "decimal"}
      step={int ? 1 : 0.01}
      min={key === "inventoryQty" ? undefined : 0}
      aria-label={`${label} for ${variantValues(v).join(" / ")}`}
      defaultValue={v[key] ?? ""}
      onBlur={(e) => {
        const raw = e.target.value;
        const n = raw === "" ? null : int ? Math.round(Number(raw)) : Number(raw);
        if (n !== (v[key] ?? null) && (n === null || Number.isFinite(n))) {
          if ((key === "price" || key === "grams" || key === "inventoryQty") && n === null) return;
          update(index, { [key]: n } as Partial<ProductVariant>);
        }
      }}
      className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
    />
  );
  const textCell = (index: number, v: ProductVariant, key: "sku" | "barcode", label: string) => (
    <input
      key={`${key}-${v[key] ?? ""}`}
      aria-label={`${label} for ${variantValues(v).join(" / ")}`}
      defaultValue={v[key] ?? ""}
      onBlur={(e) => {
        const val = e.target.value.trim();
        if (val !== (v[key] ?? ""))
          update(index, { [key]: key === "barcode" && !val ? null : val });
      }}
      className="h-8 w-36 rounded-md border bg-background px-2 font-mono text-xs"
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Options and variants</CardTitle>
        <CardDescription>
          {listing.variants.length} variant{listing.variants.length === 1 ? "" : "s"}. Inventory
          defaults to 0 and barcodes are left blank.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <OptionsEditor
          key={JSON.stringify(listing.options)}
          listing={listing}
          meta={meta}
          save={save}
        />
        {errors.length ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Fix before export</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {errors.length > 8 ? <p>and {errors.length - 8} more</p> : null}
            </AlertDescription>
          </Alert>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2Icon className="size-4" aria-hidden="true" /> Variant matrix is complete
          </p>
        )}
        <div className="relative overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Variants</caption>
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {listing.options.map((o) => (
                  <th key={o.name} scope="col" className="px-3 py-2 font-medium">
                    {o.name}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">
                  SKU
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Price
                </th>
                {meta.compareAtEnabled ? (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Compare-at
                  </th>
                ) : null}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Cost
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Weight (g)
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Inventory
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Barcode
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => {
                const index = page * PAGE_SIZE + i;
                return (
                  <tr key={variantValues(v).join("|") + index} className="border-t">
                    {variantValues(v).map((val, j) => (
                      <td key={j} className="px-3 py-1.5 whitespace-nowrap">
                        {val}
                      </td>
                    ))}
                    <td className="px-3 py-1.5">{textCell(index, v, "sku", "SKU")}</td>
                    <td className="px-3 py-1.5 text-right">
                      {numCell(index, v, "price", "Price")}
                    </td>
                    {meta.compareAtEnabled ? (
                      <td className="px-3 py-1.5 text-right">
                        {numCell(index, v, "compareAtPrice", "Compare-at price")}
                      </td>
                    ) : null}
                    <td className="px-3 py-1.5 text-right">
                      {numCell(index, v, "costPerItem", "Cost")}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {numCell(index, v, "grams", "Weight in grams", true)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {numCell(index, v, "inventoryQty", "Inventory", true)}
                    </td>
                    <td className="px-3 py-1.5">{textCell(index, v, "barcode", "Barcode")}</td>
                    <td className="px-3 py-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove variant ${variantValues(v).join(" / ")}`}
                        disabled={listing.variants.length === 1}
                        onClick={() =>
                          save({
                            ...listing,
                            variants: listing.variants.filter((_, j) => j !== index),
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <nav className="flex items-center gap-2 text-sm" aria-label="Variant pages">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </nav>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ListingStep() {
  const { view } = useWizard();
  const start = useStartJob();
  const patch = usePatchProject({ silent: true });
  const running = useJobRunning(LISTING_JOBS);
  const job = useActiveJob(LISTING_JOBS);
  const { listing, listingMeta, inputs } = view.project;
  const generate = () => start.mutate({ path: "listing" });
  const save: Save = (next, meta) =>
    patch.mutate(meta ? { listing: next, listingMeta: meta } : { listing: next });

  const meta: ListingMeta = listingMeta ?? {
    similarity: [],
    confirmMarkers: [],
    pricing: null,
    compareAtEnabled: false,
    guardrailViolations: [],
    warnings: [],
  };
  const c = inputs.context;
  const p = meta.pricing;
  const pricingDefaults: PricingInputs = {
    currency: c.currency,
    unitCost: p ? p.unitCost : c.unitCost,
    targetMarginPct: p ? p.targetMarginPct : c.targetMarginPct,
    targetPrice: p ? p.targetPrice : c.targetPrice,
    competitorPrice: p?.competitorPrice ?? null,
    competitorSource: p?.competitorSource ?? "",
    compareAtEnabled: meta.compareAtEnabled,
    regularPrice: p?.regularPrice ?? null,
  };

  return (
    <StepShell
      step="listing"
      jobTypes={["listing", "seo", "regenerate"]}
      description="Title, description, SEO, pricing and variants for your product. Everything is editable; AI actions rewrite one field at a time."
      onRegenerate={generate}
      onRetry={generate}
      regenerating={running}
      actions={
        <Button variant="ember" onClick={generate} disabled={running || start.isPending}>
          {running ? <Loader2Icon className="animate-spin" /> : <FileTextIcon />}
          {listing ? "Regenerate listing" : "Write listing"}
        </Button>
      }
    >
      {job && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" /> {job.message}
        </p>
      )}
      {listing ? (
        <>
          <ReviewCard meta={meta} />
          <BasicsCard key={listing.tags.join(",")} listing={listing} save={save} />
          <DescriptionCard key={listing.descriptionHtml} listing={listing} save={save} />
          <SeoCard listing={listing} save={save} />
          <PricingCard
            key={JSON.stringify(meta.pricing) + meta.compareAtEnabled}
            listing={listing}
            meta={meta}
            defaults={pricingDefaults}
            save={save}
          />
          <VariantsCard listing={listing} meta={meta} save={save} />
        </>
      ) : running ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-hidden="true">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <EmptyState icon={FileTextIcon} title="No listing yet">
          Write the listing from your product analysis and brand kit. It needs a brand name, which
          is chosen automatically if you haven&apos;t picked one.
        </EmptyState>
      )}
    </StepShell>
  );
}
