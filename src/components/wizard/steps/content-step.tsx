"use client";
import {
  EyeIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  Loader2Icon,
  LockIcon,
  MonitorIcon,
  PlusIcon,
  ScaleIcon,
  SmartphoneIcon,
  StoreIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { StorefrontPreview, type PreviewPage } from "@/components/storefront/storefront-preview";
import {
  ANNOUNCEMENT_MAX,
  BADGE_ICONS,
  BENEFIT_ICONS,
  FAQ_MAX,
  FAQ_MIN,
  fillPlaceholder,
  placeholderSummary,
  sectionLabel,
} from "@/lib/content/structure";
import { highlightPlaceholders } from "@/lib/listing/text";
import type {
  CollectionRule,
  HomepageSection,
  StoreCollection,
  StoreContent,
  StorePage,
} from "@/lib/schemas";
import { assetUrl } from "../dropzone";
import { useActiveJob, useJobRunning, usePatchProject, useStartJob, useWizard } from "../context";
import { EditableList, EditableText } from "../editable";
import { Field } from "../field";
import { FieldActions } from "../field-actions";
import { EmptyState, StepShell } from "../step-shell";

const CONTENT_JOBS = ["content", "regenerate", "pipeline"];

type Save = (next: StoreContent) => void;

function Actions({ field, label }: { field: string; label: string }) {
  return <FieldActions section="content_page" field={field} label={label} jobs={CONTENT_JOBS} />;
}

/* ------------------------------------------------------------------------------------------ */
/* Legal notice and placeholders                                                              */
/* ------------------------------------------------------------------------------------------ */

function LegalNotice() {
  return (
    <Alert variant="warning">
      <ScaleIcon aria-hidden="true" />
      <AlertTitle>Not legal advice</AlertTitle>
      <AlertDescription>
        The policies and terms are starting templates, not legal advice. Have a qualified lawyer
        review them for your business and every country you sell to before you publish. This notice
        is shown only here; it is not added to your store pages.
      </AlertDescription>
    </Alert>
  );
}

function PlaceholdersCard({ content, save }: { content: StoreContent; save: Save }) {
  const summary = useMemo(() => placeholderSummary(content), [content]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const fillable = summary.filter((s) => !s.token.startsWith("[CONFIRM"));
  const confirms = summary.filter((s) => s.token.startsWith("[CONFIRM"));
  const fill = (token: string) => {
    const value = (values[token] ?? "").trim();
    if (!value) return;
    save({ ...fillPlaceholder(content, token, value), placeholdersAcknowledged: false });
    setValues((v) => ({ ...v, [token]: "" }));
  };
  const total = summary.reduce((n, s) => n + s.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-5" aria-hidden="true" /> Placeholders to fill
        </CardTitle>
        <CardDescription>
          {total
            ? `${total} placeholder${total === 1 ? "" : "s"} across your pages. Fill one in here and it's replaced everywhere it appears.`
            : "Every placeholder is filled in."}
        </CardDescription>
      </CardHeader>
      {total ? (
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {fillable.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {(showAll ? fillable : fillable.slice(0, 6)).map((s) => {
                const id = `fill-${s.token.replace(/[^A-Z0-9]+/gi, "-")}`;
                return (
                  <li
                    key={s.token}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <Label htmlFor={id} className="font-mono text-xs break-words">
                        {s.token}
                      </Label>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={s.where.join(", ")}
                      >
                        {s.count}× in {s.where.join(", ")}
                      </p>
                    </div>
                    <Input
                      id={id}
                      value={values[s.token] ?? ""}
                      placeholder="Your value"
                      onChange={(e) => setValues((v) => ({ ...v, [s.token]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") fill(s.token);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!(values[s.token] ?? "").trim()}
                      onClick={() => fill(s.token)}
                    >
                      Fill everywhere
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {fillable.length > 6 ? (
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
              >
                {showAll ? "Show fewer" : `Show all ${fillable.length} placeholders`}
              </Button>
            </div>
          ) : null}
          {confirms.length ? (
            <div className="grid gap-1.5 text-sm">
              <p className="font-medium">Facts to confirm</p>
              <ul className="flex flex-wrap gap-1.5">
                {confirms.map((s) => (
                  <li key={s.token}>
                    <Badge variant="outline" className="whitespace-normal">
                      {s.token.replace(/^\[CONFIRM:\s*|\]$/g, "")}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Edit these in the page text below.</p>
            </div>
          ) : null}
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <Checkbox
              id="placeholders-ack"
              checked={content.placeholdersAcknowledged}
              onCheckedChange={(v) => save({ ...content, placeholdersAcknowledged: v === true })}
            />
            <label htmlFor="placeholders-ack" className="text-sm">
              I&apos;ll fill in the remaining placeholders in Shopify before my store goes live.
            </label>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Homepage                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function IconSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SectionEditor({
  section,
  index,
  update,
}: {
  section: HomepageSection;
  index: number;
  update: (s: HomepageSection) => void;
}) {
  const id = (k: string) => `section-${index}-${k}`;
  const heading =
    "heading" in section ? (
      <Field id={id("heading")} label="Heading">
        <EditableText
          id={id("heading")}
          key={section.heading}
          value={section.heading}
          maxLength={80}
          onCommit={(v) => update({ ...section, heading: v })}
        />
      </Field>
    ) : null;

  switch (section.type) {
    case "hero":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor={id("headline")}>Headline</Label>
              <Actions field="hero.headline" label="Homepage headline" />
            </div>
            <EditableText
              id={id("headline")}
              key={section.headline}
              value={section.headline}
              maxLength={80}
              onCommit={(v) => update({ ...section, headline: v })}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor={id("sub")}>Subheadline</Label>
              <Actions field="hero.subheadline" label="Homepage subheadline" />
            </div>
            <EditableText
              id={id("sub")}
              key={section.subheadline}
              value={section.subheadline}
              multiline
              rows={2}
              maxLength={200}
              onCommit={(v) => update({ ...section, subheadline: v })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id("cta")} label="Button label">
              <EditableText
                id={id("cta")}
                key={section.ctaLabel}
                value={section.ctaLabel}
                maxLength={30}
                onCommit={(v) => update({ ...section, ctaLabel: v })}
              />
            </Field>
            <Field id={id("link")} label="Button link" help="Links to your product page.">
              <Input id={id("link")} value={section.ctaLink} readOnly aria-readonly="true" />
            </Field>
          </div>
        </div>
      );
    case "featured_product":
    case "newsletter":
    case "rich_text":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {heading}
          {"text" in section ? (
            <Field id={id("text")} label="Text">
              <EditableText
                id={id("text")}
                key={section.text}
                value={section.text}
                multiline
                rows={2}
                onCommit={(v) => update({ ...section, text: v })}
              />
            </Field>
          ) : null}
        </div>
      );
    case "social_proof":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {heading}
          <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {section.placeholderNote} StoreForge never writes reviews or testimonials. Connect a
              reviews app in Shopify to show real ones here.
            </span>
          </p>
        </div>
      );
    case "benefits":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {heading}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {section.items.map((b, j) => (
              <li
                key={`${j}-${b.title}`}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <IconSelect
                  value={b.icon}
                  options={BENEFIT_ICONS}
                  label={`Icon for benefit ${j + 1}`}
                  onChange={(icon) =>
                    update({
                      ...section,
                      items: section.items.map((x, k) => (k === j ? { ...x, icon } : x)),
                    })
                  }
                />
                <div className="grid gap-2">
                  <EditableText
                    aria-label={`Benefit ${j + 1} title`}
                    value={b.title}
                    maxLength={60}
                    onCommit={(title) =>
                      update({
                        ...section,
                        items: section.items.map((x, k) => (k === j ? { ...x, title } : x)),
                      })
                    }
                  />
                  <EditableText
                    aria-label={`Benefit ${j + 1} text`}
                    value={b.text}
                    multiline
                    rows={2}
                    maxLength={200}
                    onCommit={(text) =>
                      update({
                        ...section,
                        items: section.items.map((x, k) => (k === j ? { ...x, text } : x)),
                      })
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove benefit ${j + 1}`}
                  disabled={section.items.length <= 2}
                  onClick={() =>
                    update({ ...section, items: section.items.filter((_, k) => k !== j) })
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={section.items.length >= 6}
              onClick={() =>
                update({
                  ...section,
                  items: [
                    ...section.items,
                    { icon: "check", title: "New benefit", text: "Describe it." },
                  ],
                })
              }
            >
              <PlusIcon /> Add benefit
            </Button>
          </div>
        </div>
      );
    case "trust_badges":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {heading}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {section.badges.map((b, j) => (
              <li
                key={`${j}-${b.label}`}
                className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              >
                <IconSelect
                  value={b.icon}
                  options={BADGE_ICONS}
                  label={`Icon for badge ${j + 1}`}
                  onChange={(icon) =>
                    update({
                      ...section,
                      badges: section.badges.map((x, k) => (k === j ? { ...x, icon } : x)),
                    })
                  }
                />
                <EditableText
                  aria-label={`Badge ${j + 1} label`}
                  value={b.label}
                  maxLength={60}
                  onCommit={(label) =>
                    update({
                      ...section,
                      badges: section.badges.map((x, k) => (k === j ? { ...x, label } : x)),
                    })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove badge ${j + 1}`}
                  disabled={section.badges.length <= 2}
                  onClick={() =>
                    update({ ...section, badges: section.badges.filter((_, k) => k !== j) })
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Only promise what your store actually does. No certifications you can&apos;t show.
          </p>
        </div>
      );
    case "faq": {
      const n = section.items.length;
      return (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {heading}
          <p
            className={
              n < FAQ_MIN || n > FAQ_MAX
                ? "text-xs font-medium text-foreground"
                : "text-xs text-muted-foreground"
            }
          >
            {n} questions (aim for {FAQ_MIN}–{FAQ_MAX}). The FAQ page has its own copy under Pages.
          </p>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {section.items.map((f, j) => (
              <li
                key={`${j}-${f.question}`}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="grid gap-2">
                  <EditableText
                    aria-label={`Question ${j + 1}`}
                    value={f.question}
                    onCommit={(question) =>
                      update({
                        ...section,
                        items: section.items.map((x, k) => (k === j ? { ...x, question } : x)),
                      })
                    }
                  />
                  <EditableText
                    aria-label={`Answer ${j + 1}`}
                    value={f.answer}
                    multiline
                    rows={2}
                    onCommit={(answer) =>
                      update({
                        ...section,
                        items: section.items.map((x, k) => (k === j ? { ...x, answer } : x)),
                      })
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove question ${j + 1}`}
                  disabled={n <= 1}
                  onClick={() =>
                    update({ ...section, items: section.items.filter((_, k) => k !== j) })
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ol>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={n >= FAQ_MAX + 2}
              onClick={() =>
                update({
                  ...section,
                  items: [...section.items, { question: "New question?", answer: "Your answer." }],
                })
              }
            >
              <PlusIcon /> Add question
            </Button>
          </div>
        </div>
      );
    }
  }
}

function HomepageEditor({ content, save }: { content: StoreContent; save: Save }) {
  const update = (i: number) => (s: HomepageSection) =>
    save({
      ...content,
      homepageSections: content.homepageSections.map((x, k) => (k === i ? s : x)),
    });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <CardTitle>Announcement bar</CardTitle>
            <CardDescription>A short line above the header on every page.</CardDescription>
          </div>
          <Actions field="announcementBar" label="Announcement bar" />
        </CardHeader>
        <CardContent className="grid gap-1.5">
          <EditableText
            aria-label="Announcement bar text"
            key={content.announcementBar}
            value={content.announcementBar}
            maxLength={ANNOUNCEMENT_MAX}
            onCommit={(announcementBar) => save({ ...content, announcementBar })}
          />
          <p className="text-xs text-muted-foreground">
            {content.announcementBar.length}/{ANNOUNCEMENT_MAX}. No countdowns or &quot;only X
            left&quot;.
          </p>
        </CardContent>
      </Card>
      {content.homepageSections.map((s, i) => (
        <Card key={`${s.type}-${i}`}>
          <CardHeader>
            <CardTitle>{sectionLabel(s.type)}</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionEditor section={s} index={i} update={update(i)} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Pages                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function PageEditor({ page, onSave }: { page: StorePage; onSave: (p: StorePage) => void }) {
  const [draft, setDraft] = useState(page.bodyHtml);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {page.title}
            {page.kind === "policy" ? <Badge variant="outline">Policy</Badge> : null}
          </CardTitle>
          <CardDescription>
            {page.kind === "policy"
              ? `In Shopify this goes in Settings › Policies and appears at /policies/${page.handle}.`
              : `Appears at /pages/${page.handle}.`}
          </CardDescription>
        </div>
        <Actions field={`pages.${page.handle}`} label={`${page.title} page`} />
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Field id={`page-title-${page.handle}`} label="Title">
          <EditableText
            id={`page-title-${page.handle}`}
            value={page.title}
            maxLength={80}
            onCommit={(title) => onSave({ ...page, title })}
          />
        </Field>
        <Tabs defaultValue="preview">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="html">Edit HTML</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <div
              className="prose-store mt-3 rounded-lg border bg-background p-4"
              dangerouslySetInnerHTML={{ __html: highlightPlaceholders(page.bodyHtml) }}
            />
          </TabsContent>
          <TabsContent value="html">
            <Textarea
              aria-label={`${page.title} HTML`}
              className="mt-3 min-h-80 font-mono text-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== page.bodyHtml) onSave({ ...page, bodyHtml: draft });
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

function PagesEditor({ content, save }: { content: StoreContent; save: Save }) {
  const [handle, setHandle] = useState(content.pages[0]?.handle ?? "");
  const page = content.pages.find((p) => p.handle === handle) ?? content.pages[0];
  if (!page) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Store pages">
        <ul className="relative flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
          {content.pages.map((p) => (
            <li key={p.handle} className="shrink-0">
              <Button
                variant={p.handle === page.handle ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                aria-current={p.handle === page.handle ? "page" : undefined}
                onClick={() => setHandle(p.handle)}
              >
                {p.title}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <PageEditor
        key={`${page.handle}:${page.bodyHtml}`}
        page={page}
        onSave={(next) =>
          save({
            ...content,
            pages: content.pages.map((p) => (p.handle === next.handle ? next : p)),
          })
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Collections and menus                                                                      */
/* ------------------------------------------------------------------------------------------ */

const COLUMNS: CollectionRule["column"][] = ["TAG", "TITLE", "TYPE", "VENDOR", "VARIANT_PRICE"];
const RELATIONS: CollectionRule["relation"][] = [
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "STARTS_WITH",
  "GREATER_THAN",
  "LESS_THAN",
];
const human = (s: string) => s.toLowerCase().replace(/_/g, " ");

function CollectionEditor({
  collection,
  onSave,
  onRemove,
}: {
  collection: StoreCollection;
  onSave: (c: StoreCollection) => void;
  onRemove?: () => void;
}) {
  const id = `collection-${collection.handle}`;
  const rules = collection.rules;
  const setRule = (i: number, patch: Partial<CollectionRule>) =>
    rules &&
    onSave({
      ...collection,
      rules: { ...rules, rules: rules.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) },
    });
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <CardTitle>{collection.title}</CardTitle>
          <CardDescription>
            /collections/{collection.handle} ·{" "}
            {rules ? "Smart collection: products are added automatically" : "Every product"}
          </CardDescription>
        </div>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2Icon /> Remove
          </Button>
        ) : (
          <Badge variant="outline">
            <LockIcon aria-hidden="true" /> Built in
          </Badge>
        )}
      </CardHeader>
      {rules ? (
        <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Field id={`${id}-title`} label="Title">
            <EditableText
              id={`${id}-title`}
              value={collection.title}
              maxLength={80}
              onCommit={(title) => onSave({ ...collection, title })}
            />
          </Field>
          <Field id={`${id}-desc`} label="Description (HTML)">
            <EditableText
              id={`${id}-desc`}
              value={collection.descriptionHtml}
              multiline
              rows={2}
              className="font-mono text-xs"
              onCommit={(descriptionHtml) => onSave({ ...collection, descriptionHtml })}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Conditions</legend>
            {rules.rules.map((r, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[9rem_10rem_minmax(0,1fr)_auto]">
                <Select
                  value={r.column}
                  onValueChange={(v) => setRule(i, { column: v as CollectionRule["column"] })}
                >
                  <SelectTrigger aria-label={`Condition ${i + 1} field`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((c) => (
                      <SelectItem key={c} value={c}>
                        Product {human(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={r.relation}
                  onValueChange={(v) => setRule(i, { relation: v as CollectionRule["relation"] })}
                >
                  <SelectTrigger aria-label={`Condition ${i + 1} relation`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {human(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <EditableText
                  aria-label={`Condition ${i + 1} value`}
                  value={r.condition}
                  onCommit={(condition) => setRule(i, { condition })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove condition ${i + 1}`}
                  disabled={rules.rules.length <= 1}
                  onClick={() =>
                    onSave({
                      ...collection,
                      rules: { ...rules, rules: rules.rules.filter((_, k) => k !== i) },
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-4">
              <Button
                size="sm"
                variant="outline"
                disabled={rules.rules.length >= 5}
                onClick={() =>
                  onSave({
                    ...collection,
                    rules: {
                      ...rules,
                      rules: [...rules.rules, { column: "TAG", relation: "EQUALS", condition: "" }],
                    },
                  })
                }
              >
                <PlusIcon /> Add condition
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-any`}
                  checked={rules.appliedDisjunctively}
                  onCheckedChange={(v) =>
                    onSave({ ...collection, rules: { ...rules, appliedDisjunctively: v } })
                  }
                />
                <Label htmlFor={`${id}-any`} className="font-normal">
                  Match any condition (instead of all)
                </Label>
              </div>
            </div>
          </fieldset>
        </CardContent>
      ) : null}
    </Card>
  );
}

function StructureEditor({ content, save }: { content: StoreContent; save: Save }) {
  const { view } = useWizard();
  const tag = view.project.listing?.tags[0] ?? "";
  const extra = content.collections.length - 1;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {content.collections.map((c, i) => (
        <CollectionEditor
          key={`${c.handle}-${JSON.stringify(c)}`}
          collection={c}
          onSave={(next) =>
            save({
              ...content,
              collections: content.collections.map((x, k) => (k === i ? next : x)),
            })
          }
          onRemove={
            c.handle === "all"
              ? undefined
              : () =>
                  save({ ...content, collections: content.collections.filter((_, k) => k !== i) })
          }
        />
      ))}
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={extra >= 2}
          onClick={() => {
            let n = content.collections.length;
            while (content.collections.some((c) => c.handle === `collection-${n}`)) n += 1;
            save({
              ...content,
              collections: [
                ...content.collections,
                {
                  handle: `collection-${n}`,
                  title: "New collection",
                  descriptionHtml: "",
                  rules: {
                    appliedDisjunctively: false,
                    rules: [{ column: "TAG", relation: "EQUALS", condition: tag }],
                  },
                },
              ],
            });
          }}
        >
          <PlusIcon /> Add smart collection
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">Up to two besides All Products.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Menus</CardTitle>
          <CardDescription>
            Built from your pages and collections so every link works. Rename items in Shopify under
            Content › Menus.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          {(
            [
              ["Main menu", content.menus.main],
              ["Footer menu", content.menus.footer],
            ] as const
          ).map(([label, items]) => (
            <div key={label} className="grid content-start gap-2">
              <p className="text-sm font-medium">{label}</p>
              <ul className="grid gap-1 text-sm">
                {items.map((m) => (
                  <li
                    key={m.url + m.title}
                    className="flex justify-between gap-3 rounded-md bg-muted/50 px-3 py-1.5"
                  >
                    <span>{m.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {m.url}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Settings                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const SOCIALS = ["instagram", "facebook", "tiktok", "pinterest", "youtube"] as const;

function SettingsEditor({ content, save }: { content: StoreContent; save: Save }) {
  const s = content.settings;
  const set = (patch: Partial<StoreContent["settings"]>) =>
    save({ ...content, settings: { ...s, ...patch } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store settings</CardTitle>
        <CardDescription>Suggestions to enter in Shopify under Settings › General.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="store-name" label="Store name">
            <EditableText
              id="store-name"
              value={s.storeName}
              maxLength={80}
              onCommit={(storeName) => set({ storeName })}
            />
          </Field>
          <Field id="store-currency" label="Currency" help="Set in Step 1.">
            <Input id="store-currency" value={s.currency} readOnly aria-readonly="true" />
          </Field>
        </div>
        <Field id="store-tagline" label="Tagline">
          <EditableText
            id="store-tagline"
            value={s.tagline}
            maxLength={120}
            onCommit={(tagline) => set({ tagline })}
          />
        </Field>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">Social links (optional)</legend>
          {SOCIALS.map((k) => (
            <Field key={k} id={`social-${k}`} label={k[0]!.toUpperCase() + k.slice(1)}>
              <EditableText
                id={`social-${k}`}
                value={s.socialLinks[k]}
                placeholder={`https://${k}.com/yourbrand`}
                onCommit={(v) => set({ socialLinks: { ...s.socialLinks, [k]: v.trim() } })}
              />
            </Field>
          ))}
        </fieldset>
        <Field
          id="checkout-notes"
          label="Checkout suggestions"
          help="One per line. Notes for you, not shown to customers."
        >
          <EditableList
            id="checkout-notes"
            value={s.checkoutNotes}
            onCommit={(checkoutNotes) => set({ checkoutNotes })}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Preview                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function PreviewPanel({ content }: { content: StoreContent }) {
  const { view, projectId } = useWizard();
  const [page, setPage] = useState<PreviewPage>("home");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const { brandKit, listing, inputs, steps } = view.project;
  const images = view.assets
    .filter((a) => !a.discarded)
    .map((a) => ({ url: assetUrl(projectId, a, true), alt: a.altText }));
  const logoUrl = brandKit?.logoSvg
    ? `/api/projects/${projectId}/brand/logo?format=svg&v=${encodeURIComponent(steps.brand.updatedAt ?? "")}`
    : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={page} onValueChange={(v) => setPage(v as PreviewPage)}>
          <TabsList aria-label="Preview page">
            <TabsTrigger value="home">Homepage</TabsTrigger>
            <TabsTrigger value="product">Product page</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={device} onValueChange={(v) => setDevice(v as "desktop" | "mobile")}>
          <TabsList aria-label="Preview device">
            <TabsTrigger value="desktop">
              <MonitorIcon aria-hidden="true" /> Desktop
            </TabsTrigger>
            <TabsTrigger value="mobile">
              <SmartphoneIcon aria-hidden="true" /> Mobile
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <EyeIcon className="size-4" aria-hidden="true" />A visual approximation using your brand
        kit. Your Shopify theme will look different.
      </p>
      {brandKit ? (
        <StorefrontPreview
          brand={brandKit}
          listing={listing}
          content={content}
          images={images}
          currency={inputs.context.currency}
          logoUrl={logoUrl}
          page={page}
          onNavigate={setPage}
          device={device}
        />
      ) : (
        <EmptyState icon={StoreIcon} title="No brand kit yet">
          Create the brand kit to preview the store in your colours and fonts.
        </EmptyState>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

export function ContentStep() {
  const { view } = useWizard();
  const start = useStartJob();
  const patch = usePatchProject({ silent: true });
  const running = useJobRunning(CONTENT_JOBS);
  const job = useActiveJob(CONTENT_JOBS);
  const { content } = view.project;
  const generate = () => start.mutate({ path: "content" });
  const save: Save = (next) => patch.mutate({ content: next });

  return (
    <StepShell
      step="content"
      jobTypes={["content", "regenerate"]}
      description="Homepage sections, pages, policies, collections and menus, with a preview of the store in your brand."
      onRegenerate={generate}
      onRetry={generate}
      regenerating={running}
      actions={
        <Button variant="ember" onClick={generate} disabled={running || start.isPending}>
          {running ? <Loader2Icon className="animate-spin" /> : <LayoutTemplateIcon />}
          {content ? "Regenerate content" : "Write store content"}
        </Button>
      }
    >
      {job && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" /> {job.message}
        </p>
      )}
      {content ? (
        <>
          <LegalNotice />
          <PlaceholdersCard content={content} save={save} />
          <Tabs defaultValue="preview" className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <TabsList aria-label="Store content sections">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="home">Homepage</TabsTrigger>
              <TabsTrigger value="pages">Pages</TabsTrigger>
              <TabsTrigger value="structure">Collections &amp; menus</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="preview">
              <PreviewPanel content={content} />
            </TabsContent>
            <TabsContent value="home">
              <HomepageEditor content={content} save={save} />
            </TabsContent>
            <TabsContent value="pages">
              <PagesEditor content={content} save={save} />
            </TabsContent>
            <TabsContent value="structure">
              <StructureEditor content={content} save={save} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsEditor
                key={JSON.stringify(content.settings)}
                content={content}
                save={save}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : running ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-hidden="true">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : (
        <EmptyState icon={FileTextIcon} title="No store content yet">
          Write the homepage, About, Contact and FAQ pages, policy templates, collections and menus
          from your product and brand kit. Missing earlier steps run automatically.
        </EmptyState>
      )}
    </StepShell>
  );
}
