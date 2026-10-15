import { rm } from "node:fs/promises";
import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { deleteProject, getProject, updateProject, type ProjectUpdate } from "@/lib/db/projects";
import { getProjectView } from "@/lib/db/views";
import { sanitizeListingHtml, sanitizePageHtml } from "@/lib/html/sanitize";
import { projectDir } from "@/lib/security/paths";
import {
  BrandKit,
  ListingMeta,
  ProductAnalysis,
  ProductListing,
  ProjectInputs,
  StoreContent,
  type WizardStep,
} from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PatchBody = z
  .object({
    name: z.string().min(1).max(120),
    inputs: ProjectInputs,
    rightsAccepted: z.boolean(),
    analysis: ProductAnalysis,
    brandKit: BrandKit,
    listing: ProductListing,
    listingMeta: ListingMeta,
    content: StoreContent,
  })
  .partial();

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  return json(await getProjectView(id));
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, PatchBody);
  const current = await getProject(id);
  const update: ProjectUpdate = { changed: [], steps: {} };
  const now = new Date().toISOString();
  const touch = (step: WizardStep) => {
    update.changed!.push(step);
    update.steps![step] = { status: "ready", updatedAt: now, error: null };
  };

  if (body.name !== undefined) update.name = body.name;
  if (body.inputs !== undefined) {
    update.inputs = body.inputs;
    if (JSON.stringify(body.inputs) !== JSON.stringify(current.inputs)) touch("input");
  }
  if (body.rightsAccepted !== undefined) {
    update.rightsAck = body.rightsAccepted
      ? { accepted: true, at: current.rightsAck.accepted ? current.rightsAck.at : now }
      : { accepted: false, at: null };
  }
  if (body.analysis !== undefined) {
    update.analysis = body.analysis;
    touch("analysis");
  }
  if (body.brandKit !== undefined) {
    update.brandKit = body.brandKit;
    touch("brand");
  }
  if (body.listing !== undefined) {
    update.listing = {
      ...body.listing,
      descriptionHtml: sanitizeListingHtml(body.listing.descriptionHtml),
    };
    touch("listing");
  }
  if (body.listingMeta !== undefined) update.listingMeta = body.listingMeta;
  if (body.content !== undefined) {
    update.content = {
      ...body.content,
      pages: body.content.pages.map((p) => ({ ...p, bodyHtml: sanitizePageHtml(p.bodyHtml) })),
      collections: body.content.collections.map((c) => ({
        ...c,
        descriptionHtml: sanitizePageHtml(c.descriptionHtml),
      })),
    };
    touch("content");
  }
  if (Object.keys(body).length === 0) throw new HttpError(400, "Nothing to update");
  const project = await updateProject(id, update);
  return json({ project });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await getProject(id);
  await deleteProject(id);
  await rm(projectDir(id), { recursive: true, force: true });
  return json({ ok: true });
});
