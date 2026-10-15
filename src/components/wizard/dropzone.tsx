"use client";
import { ImagePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { projectKey } from "@/hooks/use-project";
import { api, describeError } from "@/lib/client/api";
import type { ImageAsset } from "@/lib/schemas";
import { cn, formatBytes } from "@/lib/utils";
import { useWizard } from "./context";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const MAX_FILES = 20;

export function assetUrl(
  projectId: string,
  asset: Pick<ImageAsset, "id" | "processedPath">,
  processed = false,
) {
  return `/api/projects/${projectId}/assets/${asset.id}${processed && asset.processedPath ? "?v=processed" : ""}`;
}

export function Dropzone() {
  const { projectId, view, caps } = useWizard();
  const qc = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const assets = view.assets.filter((a) => !a.discarded);

  const upload = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;
      const room = MAX_FILES - assets.length;
      if (room <= 0) {
        toast.error(`You can add up to ${MAX_FILES} images.`);
        return;
      }
      const maxBytes = caps.maxUploadMb * 1024 * 1024;
      const tooBig = files.filter((f) => f.size > maxBytes);
      if (tooBig.length)
        toast.error(`${tooBig.map((f) => f.name).join(", ")} exceed ${caps.maxUploadMb} MB`);
      const ok = files.filter((f) => f.size <= maxBytes).slice(0, room);
      if (files.length > room)
        toast.warning(`Only the first ${room} images were added (limit ${MAX_FILES}).`);
      if (!ok.length) return;
      const form = new FormData();
      ok.forEach((f) => form.append("files", f));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/upload`);
      xhr.upload.onprogress = (e) =>
        e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        setProgress(null);
        let body: {
          assets?: ImageAsset[];
          errors?: { file: string; error: string }[];
          error?: string;
        } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (body.assets?.length)
          toast.success(`Added ${body.assets.length} image${body.assets.length > 1 ? "s" : ""}`);
        body.errors?.forEach((e) => toast.error(`${e.file}: ${e.error}`));
        if (!body.assets && body.error) toast.error(body.error);
        void qc.invalidateQueries({ queryKey: projectKey(projectId) });
      };
      xhr.onerror = () => {
        setProgress(null);
        toast.error("Upload failed. Check your connection and retry.");
      };
      setProgress(0);
      xhr.send(form);
    },
    [assets.length, caps.maxUploadMb, projectId, qc],
  );

  const remove = async (id: string) => {
    try {
      await api(`/api/projects/${projectId}/assets/${id}`, { method: "DELETE" });
      void qc.invalidateQueries({ queryKey: projectKey(projectId) });
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={cn(
          "relative grid place-items-center gap-2 rounded-xl border-2 border-dashed bg-card/60 px-6 py-8 text-center transition-colors",
          drag ? "border-ember bg-accent/50" : "border-border",
        )}
      >
        <ImagePlusIcon className="size-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">
          <label
            htmlFor={inputId}
            className="cursor-pointer font-medium text-foreground underline underline-offset-4"
          >
            Choose photos
          </label>{" "}
          <span className="text-muted-foreground">or drag them here</span>
        </p>
        <p className="text-xs text-muted-foreground">
          JPG, PNG, WebP or HEIC · up to {MAX_FILES} images · {caps.maxUploadMb} MB each · HEIC is
          converted to JPEG
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
        {progress !== null && (
          <div className="mt-2 w-full max-w-xs" aria-live="polite">
            <Progress value={progress} aria-label="Upload progress" />
            <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" /> Uploading {progress}%
            </p>
          </div>
        )}
      </div>
      {assets.length > 0 && (
        <ul
          className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6"
          aria-label="Project images"
        >
          {assets.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-lg border bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={assetUrl(projectId, a)}
                alt={a.altText || `Product image ${a.position + 1}`}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white">
                <span>
                  {a.width}×{a.height} · {formatBytes(a.bytes)}
                </span>
              </div>
              {a.origin === "scraped" && (
                <Badge variant="secondary" className="absolute top-1 left-1 text-[10px]">
                  scraped
                </Badge>
              )}
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="absolute top-1 right-1 size-7 opacity-90 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Remove image ${a.position + 1}`}
                onClick={() => void remove(a.id)}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
