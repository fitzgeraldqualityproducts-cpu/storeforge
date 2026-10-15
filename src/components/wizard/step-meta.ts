import {
  BrushIcon,
  FileTextIcon,
  ImagesIcon,
  LayoutTemplateIcon,
  PackageIcon,
  ScanSearchIcon,
  UploadIcon,
  type LucideIcon,
} from "lucide-react";
import type { WizardStep } from "@/lib/schemas";

export const STEP_META: Record<
  WizardStep,
  { n: number; title: string; blurb: string; icon: LucideIcon }
> = {
  input: { n: 1, title: "Input", blurb: "Links, photos and context", icon: UploadIcon },
  analysis: {
    n: 2,
    title: "Product analysis",
    blurb: "What we found, risk flags",
    icon: ScanSearchIcon,
  },
  brand: { n: 3, title: "Brand kit", blurb: "Name, palette, fonts, logo", icon: BrushIcon },
  listing: { n: 4, title: "Product listing", blurb: "Copy, variants, pricing", icon: FileTextIcon },
  images: { n: 5, title: "Images", blurb: "Cleaned, ordered, alt text", icon: ImagesIcon },
  content: {
    n: 6,
    title: "Store content",
    blurb: "Pages, menus, homepage",
    icon: LayoutTemplateIcon,
  },
  export: { n: 7, title: "Export", blurb: "Checklist, ZIP, Shopify", icon: PackageIcon },
};

/** Job types that produce each step's data (used for "running" state and regenerate). */
export const STEP_JOBS: Record<WizardStep, string[]> = {
  input: [],
  analysis: ["extract", "analyze"],
  brand: ["brand_names", "brand_details"],
  listing: ["listing", "seo"],
  images: ["images"],
  content: ["content"],
  export: ["export_bundle", "export_shopify"],
};
