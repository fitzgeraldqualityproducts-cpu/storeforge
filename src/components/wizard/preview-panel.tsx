"use client";
import { EyeIcon, MonitorIcon, SmartphoneIcon, StoreIcon } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StorefrontPreview, type PreviewPage } from "@/components/storefront/storefront-preview";
import type { StoreContent } from "@/lib/schemas";
import { assetUrl } from "./dropzone";
import { useWizard } from "./context";
import { EmptyState } from "./step-shell";

/** Brand-styled storefront mock with page and device toggles, shared by the content and export steps. */
export function StorePreviewPanel({ content }: { content: StoreContent }) {
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
