import type { ProjectRecord } from "@/lib/db/projects";
import type { ImageAsset, ImageRole } from "@/lib/schemas";

/**
 * Deterministic offline outputs for AI_MODE=fixture. They are derived from the project's real
 * inputs (extraction, context, images) so the rest of the pipeline exercises real data paths.
 */

const ROLES: ImageRole[] = [
  "hero",
  "angle",
  "detail",
  "lifestyle",
  "angle",
  "detail",
  "lifestyle",
  "angle",
];

export function fixtureProductName(project: ProjectRecord): string {
  const e = project.extractions.find((x) => x.title);
  const base =
    e?.title ??
    (project.inputs.context.niche
      ? `${project.inputs.context.niche} product`
      : "Everyday essential");
  return base
    .replace(/\s+[|–—-]\s+[^|–—]+$/, "")
    .trim()
    .slice(0, 80);
}

function specValue(project: ProjectRecord, re: RegExp): string | null {
  for (const e of project.extractions) {
    for (const [k, v] of Object.entries(e.specs)) if (re.test(k)) return v;
  }
  return null;
}

export function fixtureImages(name: string, assets: ImageAsset[]) {
  return assets.map((a, i) => {
    const role = ROLES[i] ?? "angle";
    const view =
      role === "hero"
        ? "front view on a plain background"
        : role === "detail"
          ? "close-up detail"
          : role === "lifestyle"
            ? "in use"
            : "side angle";
    return {
      index: i + 1,
      altText: `${name}, ${view}`.slice(0, 125),
      role,
      hasWatermark: false,
      hasTextOverlay: false,
      isProductVisible: true,
      qualityIssues: [] as string[],
    };
  });
}

export function fixtureAnalysis(project: ProjectRecord, assets: ImageAsset[]) {
  const name = fixtureProductName(project);
  const words = name.split(/\s+/);
  const productType = words
    .slice(-2)
    .join(" ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const material = specValue(project, /material/i);
  const colorOpt = project.extractions
    .flatMap((e) => e.options)
    .find((o) => /colou?r/i.test(o.name));
  const lang = project.extractions[0]?.language ?? "en";
  const isProduct = project.extractions.length === 0 || project.extractions.some((e) => e.title);
  return {
    productName: name,
    productType: productType || "Product",
    summary: `${name}. Details below come from the product source and the photos; confirm anything marked for review.`,
    materials: material ? [material] : [],
    colors: colorOpt ? colorOpt.values.slice(0, 6) : [],
    useCases: project.inputs.context.niche
      ? [`Everyday ${project.inputs.context.niche.toLowerCase()} use`]
      : ["Everyday use"],
    audience: project.inputs.context.targetCustomer
      ? [project.inputs.context.targetCustomer]
      : ["Shoppers looking for a well-made everyday product"],
    differentiators: Object.entries(project.extractions[0]?.specs ?? {})
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`),
    detectedText: [],
    isProduct,
    sourceLanguage: lang,
    imageIssues:
      assets.length < 3
        ? [`Only ${assets.length} photo${assets.length === 1 ? "" : "s"}; 3 or more work best`]
        : [],
    images: fixtureImages(name, assets),
  };
}
