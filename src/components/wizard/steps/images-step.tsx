"use client";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
  GripVerticalIcon,
  ImagesIcon,
  Loader2Icon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { projectKey } from "@/hooks/use-project";
import { api, describeError } from "@/lib/client/api";
import type { ProjectView } from "@/lib/db/views";
import type { ImageAsset, ImagePatch, ImageProcessOptions } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { assetUrl, Dropzone } from "../dropzone";
import { useActiveJob, useJobRunning, useStartJob, useWizard } from "../context";
import { EmptyState, StepShell } from "../step-shell";

const NO_VARIANT = "__none__";

type PatchBody = ImagePatch & { options?: Partial<ImageProcessOptions> };

function useImagePatch() {
  const { projectId } = useWizard();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchBody) =>
      api<{ project: ProjectView["project"]; assets: ImageAsset[] }>(
        `/api/projects/${projectId}/images`,
        { method: "PATCH", json: body },
      ),
    onMutate: async (body) => {
      // Optimistic reorder so drag-and-drop feels instant.
      if (!body.order) return;
      await qc.cancelQueries({ queryKey: projectKey(projectId) });
      qc.setQueryData<ProjectView>(projectKey(projectId), (old) => {
        if (!old) return old;
        const pos = new Map(body.order!.map((id, i) => [id, i]));
        return {
          ...old,
          assets: old.assets.map((a) =>
            pos.has(a.id) ? { ...a, position: pos.get(a.id)!, isHero: pos.get(a.id) === 0 } : a,
          ),
        };
      });
    },
    onSuccess: (data) =>
      qc.setQueryData<ProjectView>(projectKey(projectId), (old) =>
        old ? { ...old, project: data.project, assets: data.assets } : old,
      ),
    onError: (e) => {
      toast.error("Couldn't update images", { description: describeError(e) });
      void qc.invalidateQueries({ queryKey: projectKey(projectId) });
    },
  });
}

function scoreVariant(score: number | null) {
  if (score == null) return "outline" as const;
  if (score >= 75) return "success" as const;
  if (score >= 50) return "secondary" as const;
  if (score >= 30) return "warning" as const;
  return "destructive" as const;
}

function variantChoices(view: ProjectView) {
  const options = view.project.listing?.options ?? view.project.extractions[0]?.options ?? [];
  return options.flatMap((o) =>
    o.values.map((v) => ({ key: `${o.name}:${v}`, label: `${o.name}: ${v}` })),
  );
}

/** Keyed by the saved alt text so server-side changes (e.g. re-processing) reset the draft. */
function AltField({ asset, onPatch }: { asset: ImageAsset; onPatch: (body: PatchBody) => void }) {
  const [alt, setAlt] = useState(asset.altText);
  const altId = `alt-${asset.id}`;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={altId} className="text-xs">
          Alt text
        </Label>
        <span className="text-[11px] text-muted-foreground tabular-nums">{alt.length}/125</span>
      </div>
      <Input
        id={altId}
        value={alt}
        maxLength={125}
        placeholder="Describe what's in the photo"
        onChange={(e) => setAlt(e.target.value)}
        onBlur={() => {
          if (alt.trim() !== asset.altText)
            onPatch({ updates: [{ id: asset.id, altText: alt.trim() }] });
        }}
      />
    </div>
  );
}

function ImageCard({
  asset,
  index,
  showProcessed,
  variants,
  onPatch,
  busy,
}: {
  asset: ImageAsset;
  index: number;
  showProcessed: boolean;
  variants: { key: string; label: string }[];
  onPatch: (body: PatchBody) => void;
  busy: boolean;
}) {
  const { projectId } = useWizard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: asset.id,
  });
  const shown = showProcessed && asset.processedPath;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs",
        isDragging && "z-10 shadow-lg ring-2 ring-ember",
        asset.isHero && "ring-1 ring-ember/60",
      )}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assetUrl(projectId, asset, Boolean(shown))}
          alt={asset.altText || `Product image ${index + 1}`}
          className={cn("aspect-square w-full bg-muted", shown ? "object-contain" : "object-cover")}
          loading="lazy"
        />
        <button
          type="button"
          className="absolute top-2 left-2 inline-flex cursor-grab items-center gap-1 rounded-md bg-background/90 px-1.5 py-1 text-xs font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          aria-label={`Reorder image ${index + 1}. Press space to pick up, arrow keys to move, space to drop.`}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-3.5" aria-hidden="true" />
          {index + 1}
        </button>
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {asset.isHero && (
            <Badge variant="ember">
              <StarIcon className="size-3" aria-hidden="true" /> Hero
            </Badge>
          )}
          {asset.qualityScore != null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={scoreVariant(asset.qualityScore)} tabIndex={0}>
                  Quality {asset.qualityScore}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{asset.qualityNote}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="grid gap-2 p-3">
        <div className="flex flex-wrap gap-1">
          {asset.role && <Badge variant="outline">{asset.role}</Badge>}
          <Badge variant="outline">
            {asset.width}×{asset.height}
          </Badge>
          {asset.flags.map((f) => (
            <Tooltip key={f.code}>
              <TooltipTrigger asChild>
                <Badge
                  tabIndex={0}
                  variant={
                    f.code === "third_party_source" || f.code === "watermark"
                      ? "warning"
                      : f.code === "background_removed"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {f.code.replace(/_/g, " ")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{f.message}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <AltField key={asset.altText} asset={asset} onPatch={onPatch} />
        {variants.length > 0 && (
          <div className="grid gap-1">
            <Label className="text-xs" id={`variant-${asset.id}`}>
              Variant image for
            </Label>
            <Select
              value={asset.variantKey ?? NO_VARIANT}
              onValueChange={(v) =>
                onPatch({ updates: [{ id: asset.id, variantKey: v === NO_VARIANT ? null : v }] })
              }
            >
              <SelectTrigger aria-labelledby={`variant-${asset.id}`} className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_VARIANT}>All variants</SelectItem>
                {variants.map((v) => (
                  <SelectItem key={v.key} value={v.key}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={asset.isHero || busy}
            onClick={() => onPatch({ heroId: asset.id })}
          >
            <StarIcon /> {asset.isHero ? "Hero" : "Set hero"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Discard image ${index + 1}`}
            disabled={busy}
            onClick={() => onPatch({ updates: [{ id: asset.id, discarded: true }] })}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function ImagesStep() {
  const { view, caps } = useWizard();
  const start = useStartJob();
  const patch = useImagePatch();
  const running = useJobRunning(["images", "pipeline"]);
  const activeJob = useActiveJob(["images"]);
  const status = view.project.steps.images.status;
  const opts = view.project.imageOptions;
  const [showProcessed, setShowProcessed] = useState(true);

  const active = useMemo(
    () => view.assets.filter((a) => !a.discarded).sort((a, b) => a.position - b.position),
    [view.assets],
  );
  const discarded = view.assets.filter((a) => a.discarded);
  const variants = useMemo(() => variantChoices(view), [view]);
  const scraped = active.some((a) => a.origin === "scraped");
  const processedAny = active.some((a) => a.processedPath);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = active.map((a) => a.id);
    const order = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    patch.mutate({ order });
  };

  const process = () => start.mutate({ path: "images/process", body: {} });

  return (
    <StepShell
      step="images"
      jobTypes={["images"]}
      description="We remove duplicates, score quality, put the best shot first, square and compress every image, and write alt text. Drag to reorder."
      onRegenerate={process}
      onRetry={process}
      regenerating={running}
      actions={
        <Button variant="ember" onClick={process} disabled={running || active.length === 0}>
          {running ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {processedAny ? "Re-process images" : "Process images"}
        </Button>
      }
    >
      {scraped && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>Some images came from a third-party page</AlertTitle>
          <AlertDescription>
            Images marked “third party source” were downloaded from the URL you entered. They may be
            copyrighted or watermarked. Only publish them if you own them or have the
            supplier&apos;s permission; replacing them with your own photos is safest.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <Label htmlFor="square-pad" className="grid gap-0.5">
            <span>Square canvas</span>
            <span className="text-xs font-normal text-muted-foreground">
              Pads to 1:1 for tidy grids
            </span>
          </Label>
          <Switch
            id="square-pad"
            checked={opts.squarePad}
            onCheckedChange={(v) => patch.mutate({ options: { squarePad: v } })}
          />
        </div>
        <div className="grid gap-1">
          <Label id="bg-label">Canvas colour</Label>
          <Select
            value={opts.background}
            onValueChange={(v) => patch.mutate({ options: { background: v as "white" | "brand" } })}
          >
            <SelectTrigger aria-labelledby="bg-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="white">White</SelectItem>
              <SelectItem value="brand" disabled={!view.project.brandKit?.palette}>
                Brand background
                {view.project.brandKit?.palette
                  ? ` (${view.project.brandKit.palette.background})`
                  : " (create a brand kit first)"}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <Label htmlFor="remove-bg" className="grid gap-0.5">
            <span>Remove background</span>
            <span className="text-xs font-normal text-muted-foreground">
              {caps.removeBgConfigured
                ? `Uses ${caps.removeBgProvider}`
                : "Not configured on this server"}
            </span>
          </Label>
          <Switch
            id="remove-bg"
            checked={opts.removeBackground}
            disabled={!caps.removeBgConfigured}
            onCheckedChange={(v) => patch.mutate({ options: { removeBackground: v } })}
          />
        </div>
      </div>

      {activeJob && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" />{" "}
          {activeJob.message || "Processing images…"}
        </p>
      )}

      {active.length === 0 ? (
        <EmptyState icon={ImagesIcon} title="No images yet">
          Add photos below, or add a product URL in Step 1 and we&apos;ll pull its images.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {active.length} image{active.length === 1 ? "" : "s"} in the listing
              {status !== "ready" && processedAny ? " · settings changed, re-process to apply" : ""}
              {active.length < 3 ? " · add at least 3 for a stronger listing" : ""}
            </p>
            {processedAny && (
              <Tabs
                value={showProcessed ? "processed" : "original"}
                onValueChange={(v) => setShowProcessed(v === "processed")}
              >
                <TabsList>
                  <TabsTrigger value="processed">Processed</TabsTrigger>
                  <TabsTrigger value="original">Original</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={active.map((a) => a.id)} strategy={rectSortingStrategy}>
              <ul
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-label="Listing images in order"
              >
                {active.map((a, i) => (
                  <ImageCard
                    key={a.id}
                    asset={a}
                    index={i}
                    showProcessed={showProcessed}
                    variants={variants}
                    busy={patch.isPending}
                    onPatch={(b) => patch.mutate(b)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      {discarded.length > 0 && (
        <details className="rounded-xl border bg-card/60 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {discarded.length} image{discarded.length === 1 ? "" : "s"} set aside
          </summary>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {discarded.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border bg-background p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetUrl(view.project.id, a)}
                  alt={a.altText || "Set-aside image"}
                  className="size-14 rounded-md object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {a.discardReason === "user" ? "Removed by you" : a.discardReason}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => patch.mutate({ updates: [{ id: a.id, discarded: false }] })}
                >
                  <ArchiveRestoreIcon /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="rounded-xl border bg-card/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Add more photos</summary>
        <div className="mt-3">
          <Dropzone />
        </div>
      </details>
    </StepShell>
  );
}
