"use client";
import {
  BrushIcon,
  CheckCircle2Icon,
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PaletteIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  TypeIcon,
  WandSparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { checkPalette, enforcePalette, normalizeHex } from "@/lib/brand/contrast";
import { googleFontsHref, resolveFont, SHOPIFY_LIBRARY_FONTS } from "@/lib/brand/fonts";
import { availabilityLookupUrl, PREFERRED_MAX_LENGTH } from "@/lib/brand/names";
import type { BrandKit, NameCandidate, Palette } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useActiveJob, useJobRunning, usePatchProject, useStartJob, useWizard } from "../context";
import { EditableList, EditableText } from "../editable";
import { Field } from "../field";
import { EmptyState, StepShell } from "../step-shell";

const BRAND_JOBS = ["brand_names", "brand_details", "pipeline"];

function NameCard({
  c,
  selected,
  disabled,
  onUse,
}: {
  c: NameCandidate;
  selected: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const checks = c.checks;
  return (
    <li
      className={cn(
        "grid content-start gap-2 rounded-xl border bg-card p-4",
        selected && "border-primary ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-2xl leading-tight break-words">{c.name}</h3>
        {selected ? (
          <Badge variant="success">
            <CheckIcon className="size-3" aria-hidden="true" /> Selected
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{c.rationale}</p>
      {checks ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Quick checks">
          <li>
            <Badge variant={checks.length > PREFERRED_MAX_LENGTH ? "warning" : "outline"}>
              {checks.length} characters
            </Badge>
          </li>
          <li>
            <Badge variant={checks.pronounceable ? "outline" : "warning"}>
              {checks.pronounceable ? "Easy to say" : "Hard to say"}
            </Badge>
          </li>
          {checks.hasDigitsOrSymbols ? (
            <li>
              <Badge variant="warning">Digits or symbols</Badge>
            </li>
          ) : null}
        </ul>
      ) : null}
      {checks?.notes.length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {checks.notes.map((n) => (
            <li key={n} className="flex gap-1">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> {n}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-1 rounded-lg bg-muted/60 p-2 text-xs">
        <span>
          Domain idea: <code className="font-mono">{c.domainSuggestion}</code>
        </span>
        <span className="text-muted-foreground">
          Not checked. Registration and trademarks are yours to verify.
        </span>
        <a
          href={availabilityLookupUrl(c.domainSuggestion)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
        >
          Check availability <ExternalLinkIcon className="size-3" aria-hidden="true" />
          <span className="sr-only">(opens ICANN lookup in a new tab)</span>
        </a>
      </div>
      <Button
        size="sm"
        variant={selected ? "outline" : "default"}
        onClick={onUse}
        disabled={disabled || selected}
        className="mt-1 w-fit"
      >
        {selected ? "In use" : "Use this name"}
      </Button>
    </li>
  );
}

function OwnNameForm({ onUse, disabled }: { onUse: (name: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  const name = value.trim();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name) onUse(name);
      }}
    >
      <Field id="own-name" label="Or use your own name" className="min-w-0 flex-1">
        <Input
          id="own-name"
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type a brand name"
        />
      </Field>
      <Button type="submit" variant="outline" disabled={disabled || !name}>
        Use this name
      </Button>
    </form>
  );
}

const SWATCHES: { key: keyof Palette; label: string; help: string }[] = [
  { key: "primary", label: "Primary", help: "Buttons and links" },
  { key: "secondary", label: "Secondary", help: "Supporting elements" },
  { key: "accent", label: "Accent", help: "Small highlights" },
  { key: "background", label: "Background", help: "Page background" },
  { key: "surface", label: "Surface", help: "Cards and sections" },
  { key: "text", label: "Text", help: "Body copy" },
];

const isHex = (v: string) => /^#?[0-9a-f]{6}$/i.test(v.trim());

function PaletteEditor({ palette, onSave }: { palette: Palette; onSave: (p: Palette) => void }) {
  const [draft, setDraft] = useState<Palette>(palette);
  const [text, setText] = useState<Record<keyof Palette, string>>(palette);
  const [changes, setChanges] = useState<string[]>([]);
  const checks = useMemo(() => checkPalette(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(palette);
  const failing = checks.filter((c) => c.required && !c.pass).length;

  const setColor = (key: keyof Palette, value: string) => {
    setText((t) => ({ ...t, [key]: value }));
    if (isHex(value)) setDraft((d) => ({ ...d, [key]: normalizeHex(value) }));
  };
  const replaceAll = (p: Palette) => {
    setDraft(p);
    setText(p);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaletteIcon className="size-5" aria-hidden="true" /> Colour palette
        </CardTitle>
        <CardDescription>
          Contrast is checked live against WCAG AA (4.5:1 for body text and button labels).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map((s) => {
            const id = `color-${s.key}`;
            return (
              <div key={s.key} className="grid gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {s.label}
                  <span className="block text-xs font-normal text-muted-foreground">{s.help}</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${s.label} colour picker`}
                    value={draft[s.key].toLowerCase()}
                    onChange={(e) => setColor(s.key, e.target.value)}
                    className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                  />
                  <Input
                    id={id}
                    value={text[s.key]}
                    onChange={(e) => setColor(s.key, e.target.value)}
                    aria-invalid={!isHex(text[s.key]) || undefined}
                    className="font-mono uppercase"
                    maxLength={7}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="grid gap-3 rounded-xl border p-4"
          style={{ background: draft.background, color: draft.text }}
          aria-label="Palette preview"
        >
          <p className="text-sm">Body text on the page background reads like this.</p>
          <div className="rounded-lg p-3 text-sm" style={{ background: draft.surface }}>
            Body text on a card or section.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: draft.primary, color: draft.background }}
            >
              Add to cart
            </span>
            <span className="text-sm font-medium" style={{ color: draft.accent }}>
              ● Accent highlight
            </span>
            <span className="text-sm" style={{ color: draft.secondary }}>
              Secondary detail
            </span>
          </div>
        </div>

        <table className="w-full text-sm">
          <caption className="sr-only">Contrast checks</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Pair</th>
              <th className="py-1 text-right font-medium">Ratio</th>
              <th className="py-1 text-right font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-2 pr-2">
                  {c.label}
                  {!c.required ? (
                    <span className="text-xs text-muted-foreground"> (advisory)</span>
                  ) : null}
                </td>
                <td className="py-2 text-right font-mono whitespace-nowrap tabular-nums">
                  {c.ratio.toFixed(2)}:1
                  <span className="text-xs text-muted-foreground"> / {c.min}</span>
                </td>
                <td className="py-2 text-right">
                  {c.pass ? (
                    <Badge variant="success">
                      <CheckCircle2Icon className="size-3" aria-hidden="true" /> Pass
                    </Badge>
                  ) : (
                    <Badge variant={c.required ? "destructive" : "warning"}>
                      <XCircleIcon className="size-3" aria-hidden="true" /> Fail
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {changes.length ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Adjusted: {changes.join("; ")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={failing === 0}
            onClick={() => {
              const fixed = enforcePalette(draft);
              replaceAll(fixed.palette);
              setChanges(fixed.changes);
            }}
          >
            <WandSparklesIcon /> Fix contrast automatically
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              onSave(draft);
              setChanges([]);
            }}
          >
            Save colours
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                replaceAll(palette);
                setChanges([]);
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
        {failing > 0 ? (
          <p className="text-sm text-destructive" role="status">
            {failing} required contrast check{failing === 1 ? "" : "s"} failing. Export is blocked
            until they pass.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FontField({
  id,
  label,
  family,
  onCommit,
}: {
  id: string;
  label: string;
  family: string;
  onCommit: (family: string) => void;
}) {
  const [value, setValue] = useState(family);
  const choice = resolveFont(value || family);
  return (
    <div className="grid gap-2">
      <Field id={id} label={label}>
        <Input
          id={id}
          list="shopify-fonts"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const v = value.trim();
            if (v && v !== family) onCommit(v);
            else setValue(family);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-describedby={`${id}-note`}
        />
      </Field>
      <p id={`${id}-note`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
        {choice.inShopifyLibrary ? (
          <CheckCircle2Icon className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden="true" />
        )}
        {choice.note}
      </p>
    </div>
  );
}

function FontsCard({ kit, onChange }: { kit: BrandKit; onChange: (k: BrandKit) => void }) {
  const fonts = kit.fonts!;
  const href = googleFontsHref([fonts.heading.family, fonts.body.family]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TypeIcon className="size-5" aria-hidden="true" /> Fonts
        </CardTitle>
        <CardDescription>
          One heading and one body family from Google Fonts. Families in Shopify&apos;s font library
          work in the theme with no uploads.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* React hoists this stylesheet into <head>; CSP allows Google Fonts. */}
        <link rel="stylesheet" href={href} precedence="default" />
        <datalist id="shopify-fonts">
          {SHOPIFY_LIBRARY_FONTS.map((f) => (
            <option key={f.family} value={f.family} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <FontField
            key={`h-${fonts.heading.family}`}
            id="font-heading"
            label="Heading font"
            family={fonts.heading.family}
            onCommit={(family) =>
              onChange({ ...kit, fonts: { ...fonts, heading: resolveFont(family) } })
            }
          />
          <FontField
            key={`b-${fonts.body.family}`}
            id="font-body"
            label="Body font"
            family={fonts.body.family}
            onCommit={(family) =>
              onChange({ ...kit, fonts: { ...fonts, body: resolveFont(family) } })
            }
          />
        </div>
        <div
          className="grid gap-2 rounded-xl border p-5"
          style={{ background: kit.palette?.background, color: kit.palette?.text }}
        >
          <p
            className="text-3xl leading-tight"
            style={{ fontFamily: `'${fonts.heading.family}', serif`, fontWeight: 700 }}
          >
            {kit.selectedName}
          </p>
          <p style={{ fontFamily: `'${fonts.body.family}', sans-serif` }}>
            {kit.tagline || "Your tagline appears here."}
          </p>
          <p
            className="text-sm opacity-80"
            style={{ fontFamily: `'${fonts.body.family}', sans-serif` }}
          >
            The quick brown fox jumps over the lazy dog. 0123456789
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LogoCard({ kit, version }: { kit: BrandKit; version: string }) {
  const { projectId } = useWizard();
  const base = `/api/projects/${projectId}/brand/logo`;
  const p = kit.palette!;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrushIcon className="size-5" aria-hidden="true" /> Logo wordmark
        </CardTitle>
        <CardDescription>
          Generated from the name, heading font and palette. It updates when you change any of them.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { bg: p.background, label: "On the page background" },
            { bg: p.surface, label: "On a section background" },
          ].map((v) => (
            <figure key={v.label} className="grid gap-1.5">
              <div
                className="grid h-36 place-items-center rounded-xl border p-6"
                style={{ background: v.bg }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${base}?format=svg&v=${version}`}
                  alt={`${kit.selectedName} logo`}
                  className="max-h-20 max-w-full object-contain"
                />
              </div>
              <figcaption className="text-xs text-muted-foreground">{v.label}</figcaption>
            </figure>
          ))}
        </div>
        {!kit.logoOutlined ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Logo uses live text</AlertTitle>
            <AlertDescription>
              The heading font couldn&apos;t be downloaded, so the SVG uses the font name with a
              generic fallback and may look different on other computers. Change the font or save
              the palette again when you&apos;re online to redraw it as outlines.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`${base}?format=svg&download=1&v=${version}`} download>
              <DownloadIcon /> Download SVG
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`${base}?format=png&download=1&v=${version}`} download>
              <DownloadIcon /> Download PNG
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function BrandStep() {
  const { view } = useWizard();
  const start = useStartJob();
  const patch = usePatchProject({ silent: true });
  const running = useJobRunning(BRAND_JOBS);
  const job = useActiveJob(BRAND_JOBS);
  const kit = view.project.brandKit;
  const candidates = kit?.nameCandidates ?? [];
  const hasDetails = Boolean(kit?.palette && kit.fonts && kit.selectedName);
  const busy = running || patch.isPending;

  const generateNames = () => start.mutate({ path: "brand", body: { action: "names" } });
  const generateDetails = (name?: string) =>
    start.mutate({ path: "brand", body: { action: "details", ...(name ? { name } : {}) } });
  const save = (next: BrandKit) => patch.mutate({ brandKit: next });

  /** With a kit already built, switching names keeps the colours and fonts. */
  const chooseName = (name: string) => {
    if (hasDetails && kit) save({ ...kit, selectedName: name });
    else generateDetails(name);
  };

  return (
    <StepShell
      step="brand"
      jobTypes={["brand_names", "brand_details"]}
      description="Pick a name, then review the tagline, voice, colours, fonts and logo. Everything is editable."
      onRegenerate={() => generateDetails()}
      onRetry={() => (candidates.length ? generateDetails() : generateNames())}
      regenerating={running}
      actions={
        <>
          <Button variant="outline" onClick={generateNames} disabled={busy}>
            <SparklesIcon /> {candidates.length ? "New name ideas" : "Generate name ideas"}
          </Button>
          {kit?.selectedName ? (
            <Button variant="ember" onClick={() => generateDetails()} disabled={busy}>
              {running ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              {hasDetails ? "Regenerate brand kit" : "Build brand kit"}
            </Button>
          ) : null}
        </>
      }
    >
      {job && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" /> {job.message}
        </p>
      )}

      <section aria-labelledby="names-title" className="grid gap-3">
        <h2 id="names-title" className="font-display text-2xl">
          Name
        </h2>
        {candidates.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((c) => (
              <NameCard
                key={c.name}
                c={c}
                selected={kit?.selectedName === c.name}
                disabled={busy}
                onUse={() => chooseName(c.name)}
              />
            ))}
          </ul>
        ) : running ? (
          <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <EmptyState icon={SparklesIcon} title="No name ideas yet">
            Generate six ideas based on your product and tone, or type your own name below.
          </EmptyState>
        )}
        <OwnNameForm onUse={chooseName} disabled={busy} />
      </section>

      {hasDetails && kit ? (
        <>
          <section aria-labelledby="identity-title" className="grid gap-3">
            <h2 id="identity-title" className="font-display text-2xl">
              Tagline and voice
            </h2>
            <Card>
              <CardContent className="grid gap-4 pt-6">
                <Field
                  id="tagline"
                  label="Tagline"
                  help={`${kit.tagline.length}/60 characters. No superlatives or claims.`}
                >
                  <EditableText
                    key={kit.tagline}
                    id="tagline"
                    value={kit.tagline}
                    maxLength={60}
                    aria-describedby="tagline-help"
                    onCommit={(v) => save({ ...kit, tagline: v.trim() })}
                  />
                </Field>
                {kit.voice ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field id="voice-adjectives" label="Voice" help="One adjective per line">
                      <EditableList
                        key={kit.voice.adjectives.join("|")}
                        id="voice-adjectives"
                        value={kit.voice.adjectives}
                        onCommit={(v) =>
                          v.length &&
                          save({ ...kit, voice: { ...kit.voice!, adjectives: v.slice(0, 6) } })
                        }
                      />
                    </Field>
                    <Field id="voice-do" label="Do" help="One guideline per line">
                      <EditableList
                        key={kit.voice.do.join("|")}
                        id="voice-do"
                        rows={5}
                        value={kit.voice.do}
                        onCommit={(v) =>
                          v.length && save({ ...kit, voice: { ...kit.voice!, do: v.slice(0, 8) } })
                        }
                      />
                    </Field>
                    <Field id="voice-dont" label="Don't" help="One guideline per line">
                      <EditableList
                        key={kit.voice.dont.join("|")}
                        id="voice-dont"
                        rows={5}
                        value={kit.voice.dont}
                        onCommit={(v) =>
                          v.length &&
                          save({ ...kit, voice: { ...kit.voice!, dont: v.slice(0, 8) } })
                        }
                      />
                    </Field>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="look-title" className="grid gap-3">
            <h2 id="look-title" className="font-display text-2xl">
              Look and feel
            </h2>
            <PaletteEditor
              key={JSON.stringify(kit.palette)}
              palette={kit.palette!}
              onSave={(palette) => save({ ...kit, palette })}
            />
            <FontsCard kit={kit} onChange={save} />
            {kit.logoSvg ? <LogoCard kit={kit} version={hashString(kit.logoSvg)} /> : null}
          </section>
        </>
      ) : candidates.length && !running ? (
        <p className="text-sm text-muted-foreground">
          Choose a name above to build the tagline, voice guide, palette, fonts and logo.
        </p>
      ) : null}
    </StepShell>
  );
}
