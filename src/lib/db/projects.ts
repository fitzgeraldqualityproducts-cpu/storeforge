import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Project as ProjectRow } from "@/generated/prisma/client";
import {
  BrandKit,
  ImageProcessOptions,
  ListingMeta,
  ProductAnalysis,
  ProductListing,
  ProjectInputs,
  RightsAck,
  SourceExtraction,
  StepsState,
  StoreContent,
  type ProjectStatus,
  type WizardStep,
} from "@/lib/schemas";
import { markStale, type StepsPatch } from "@/lib/staleness";
import { prisma } from "./client";

function parseJson<T>(schema: z.ZodType<T>, raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export interface ProjectRecord {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  inputs: ProjectInputs;
  rightsAck: RightsAck;
  steps: StepsState;
  extractions: SourceExtraction[];
  analysis: ProductAnalysis | null;
  brandKit: BrandKit | null;
  listing: ProductListing | null;
  listingMeta: ListingMeta | null;
  content: StoreContent | null;
  imageOptions: ImageProcessOptions;
}

export function hydrate(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    status: (["draft", "generating", "ready", "exported"].includes(row.status)
      ? row.status
      : "draft") as ProjectStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    inputs: parseJson(ProjectInputs, row.inputs, ProjectInputs.parse({})),
    rightsAck: parseJson(RightsAck, row.rightsAck, { accepted: false, at: null }),
    steps: parseJson(StepsState, row.steps, StepsState.parse({})),
    extractions: parseJson(z.array(SourceExtraction), row.extractions, []),
    analysis: parseJson(ProductAnalysis.nullable(), row.analysis, null),
    brandKit: parseJson(BrandKit.nullable(), row.brandKit, null),
    listing: parseJson(ProductListing.nullable(), row.listing, null),
    listingMeta: parseJson(ListingMeta.nullable(), row.listingMeta, null),
    content: parseJson(StoreContent.nullable(), row.content, null),
    imageOptions: parseJson(ImageProcessOptions, row.imageOptions, ImageProcessOptions.parse({})),
  };
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export async function createProject(name: string): Promise<ProjectRecord> {
  const row = await prisma.project.create({
    data: {
      id: randomUUID(),
      name: name.trim() || "Untitled store",
      inputs: JSON.stringify(ProjectInputs.parse({})),
      steps: JSON.stringify(StepsState.parse({})),
    },
  });
  return hydrate(row);
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(hydrate);
}

export async function getProject(id: string): Promise<ProjectRecord> {
  const row = await prisma.project.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Project");
  return hydrate(row);
}

export async function findProject(id: string): Promise<ProjectRecord | null> {
  const row = await prisma.project.findUnique({ where: { id } });
  return row ? hydrate(row) : null;
}

export async function deleteProject(id: string) {
  await prisma.project.delete({ where: { id } });
}

export interface ProjectUpdate {
  name?: string;
  status?: ProjectStatus;
  inputs?: ProjectInputs;
  rightsAck?: RightsAck;
  extractions?: SourceExtraction[];
  analysis?: ProductAnalysis | null;
  brandKit?: BrandKit | null;
  listing?: ProductListing | null;
  listingMeta?: ListingMeta | null;
  content?: StoreContent | null;
  imageOptions?: ImageProcessOptions;
  /** Explicit step status changes applied after staleness propagation. */
  steps?: StepsPatch;
  /** Which step's data changed; downstream steps are marked stale. */
  changed?: WizardStep[];
}

const js = (v: unknown) => (v === null ? null : JSON.stringify(v));

/**
 * Applies an update atomically. Steps downstream of `changed` are marked stale, then explicit
 * `steps` overrides are applied (so a generator can mark its own step ready in the same write).
 */
export async function updateProject(id: string, u: ProjectUpdate): Promise<ProjectRecord> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.project.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Project");
    const current = hydrate(row);
    let steps = current.steps;
    if (u.changed?.length) steps = markStale(steps, u.changed);
    if (u.steps) {
      for (const [k, v] of Object.entries(u.steps)) {
        const key = k as WizardStep;
        steps = { ...steps, [key]: { ...steps[key], ...v } };
      }
    }
    const data: Record<string, unknown> = { steps: JSON.stringify(steps) };
    if (u.name !== undefined) data.name = u.name;
    if (u.status !== undefined) data.status = u.status;
    if (u.inputs !== undefined) data.inputs = JSON.stringify(u.inputs);
    if (u.rightsAck !== undefined) data.rightsAck = JSON.stringify(u.rightsAck);
    if (u.extractions !== undefined) data.extractions = JSON.stringify(u.extractions);
    if (u.analysis !== undefined) data.analysis = js(u.analysis);
    if (u.brandKit !== undefined) data.brandKit = js(u.brandKit);
    if (u.listing !== undefined) data.listing = js(u.listing);
    if (u.listingMeta !== undefined) data.listingMeta = js(u.listingMeta);
    if (u.content !== undefined) data.content = js(u.content);
    if (u.imageOptions !== undefined) data.imageOptions = JSON.stringify(u.imageOptions);
    const updated = await tx.project.update({ where: { id }, data });
    return hydrate(updated);
  });
}
