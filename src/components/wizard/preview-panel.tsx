"use client";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  EyeIcon,
  HouseIcon,
  LockIcon,
  MonitorIcon,
  RotateCwIcon,
  SmartphoneIcon,
  StoreIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import { productPath, resolvePreviewRoute } from "@/lib/content/preview-routes";
import type { ProjectView } from "@/lib/db/views";
import { toHandle } from "@/lib/listing/text";
import type { StoreContent } from "@/lib/schemas";
import { assetUrl } from "./dropzone";
import { useWizard } from "./context";
import { EmptyState } from "./step-shell";

/** Path of the full-page preview for a project. */
export const previewHref = (projectId: string, path = "/") =>
  `/projects/${projectId}/preview${path === "/" ? "" : `?path=${encodeURIComponent(path)}`}`;

/** Back/forward history for the in-app browser. */
function useBrowserHistory(initial: string, onChange?: (path: string) => void) {
  const [state, setState] = useState({ stack: [initial], index: 0 });
  const path = state.stack[state.index]!;
  const move = (index: number) => {
    setState((s) => ({ ...s, index }));
    onChange?.(state.stack[index]!);
  };
  return {
    path,
    canBack: state.index > 0,
    canForward: state.index < state.stack.length - 1,
    back: () => move(state.index - 1),
    forward: () => move(state.index + 1),
    navigate: (to: string) => {
      if (to === path) return;
      setState((s) => ({ stack: [...s.stack.slice(0, s.index + 1), to], index: s.index + 1 }));
      onChange?.(to);
    },
  };
}

/**
 * The generated store as a clickable website inside StoreForge: a browser bar with back,
 * forward and the page address, the store's own menus, and desktop/mobile widths. Shared by the
 * content step, the export step, the header's preview window and the full-page preview.
 */
export function StorePreview({
  projectId,
  view,
  content,
  initialPath = "/",
  onPathChange,
  showOpenInNewTab = true,
}: {
  projectId: string;
  view: ProjectView;
  content: StoreContent;
  initialPath?: string;
  onPathChange?: (path: string) => void;
  showOpenInNewTab?: boolean;
}) {
  const history = useBrowserHistory(initialPath, onPathChange);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [reloads, setReloads] = useState(0);
  const { brandKit, listing, inputs, steps } = view.project;
  const images = view.assets
    .filter((a) => !a.discarded)
    .map((a) => ({ url: assetUrl(projectId, a, true), alt: a.altText }));
  const logoUrl = brandKit?.logoSvg
    ? `/api/projects/${projectId}/brand/logo?format=svg&v=${encodeURIComponent(steps.brand.updatedAt ?? "")}`
    : null;
  const storeName = content.settings.storeName || brandKit?.selectedName || "your-store";
  const domain = `${toHandle(storeName, 40) || "your-store"}.myshopify.com`;
  const route = resolvePreviewRoute(history.path, content).kind;
  const quickPage = route === "home" ? "home" : route === "product" ? "product" : "";

  const toolbar = (
    <div
      className="flex items-center gap-1 border-b bg-muted/70 px-2 py-1.5 font-sans text-foreground"
      data-testid="preview-browser-bar"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={history.back}
        disabled={!history.canBack}
        aria-label="Back"
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={history.forward}
        disabled={!history.canForward}
        aria-label="Forward"
      >
        <ArrowRightIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setReloads((n) => n + 1)}
        aria-label="Reload"
        className="hidden sm:inline-flex"
      >
        <RotateCwIcon />
      </Button>
      <p
        className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-3 text-xs"
        aria-label="Page address"
      >
        <LockIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          <span className="text-muted-foreground">{domain}</span>
          {history.path === "/" ? "" : history.path}
        </span>
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => history.navigate("/")}
        aria-label="Store homepage"
      >
        <HouseIcon />
      </Button>
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={quickPage}
          onValueChange={(v) => history.navigate(v === "home" ? "/" : productPath(listing))}
        >
          <TabsList aria-label="Preview page">
            <TabsTrigger value="home">Homepage</TabsTrigger>
            <TabsTrigger value="product">Product page</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
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
          {showOpenInNewTab ? (
            <Button variant="outline" size="sm" asChild>
              <a href={previewHref(projectId, history.path)} target="_blank" rel="noopener">
                <ExternalLinkIcon aria-hidden="true" /> Open in new tab
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <EyeIcon className="size-4 shrink-0" aria-hidden="true" />
        Click around like a shopper: menus, pages and policies all work. It&apos;s a close
        approximation in your brand kit; your Shopify theme will look a little different.
      </p>
      {brandKit ? (
        <StorefrontPreview
          key={reloads}
          brand={brandKit}
          listing={listing}
          content={content}
          images={images}
          currency={inputs.context.currency}
          logoUrl={logoUrl}
          path={history.path}
          onNavigate={history.navigate}
          device={device}
          toolbar={toolbar}
        />
      ) : (
        <EmptyState icon={StoreIcon} title="No brand kit yet">
          Create the brand kit to preview the store in your colours and fonts.
        </EmptyState>
      )}
    </div>
  );
}

/** {@link StorePreview} for the current wizard project. */
export function StorePreviewPanel({ content }: { content: StoreContent }) {
  const { view, projectId } = useWizard();
  return <StorePreview projectId={projectId} view={view} content={content} />;
}

/** A large preview window, opened from the header on any step or from the export step. */
export function StorePreviewDialog({
  content,
  trigger,
}: {
  content: StoreContent;
  trigger: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="h-[95vh] max-h-[95vh] w-[calc(100%-2rem)] max-w-[min(1400px,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Store preview</DialogTitle>
          <DialogDescription>Nothing here is published until you push it.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <StorePreviewPanel content={content} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Header button: the store preview, reachable from every step once there's content. */
export function HeaderPreviewButton() {
  const { view } = useWizard();
  const { content, brandKit } = view.project;
  if (!content || !brandKit) return null;
  return (
    <StorePreviewDialog
      content={content}
      trigger={
        <Button variant="outline" size="sm" title="See your store as a website">
          <EyeIcon aria-hidden="true" />
          <span className="hidden sm:inline">Preview store</span>
          <span className="sr-only sm:hidden">Preview store</span>
        </Button>
      }
    />
  );
}
