import { rm } from "node:fs/promises";
import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { normalizeHex } from "@/lib/brand/contrast";
import { resolveFont } from "@/lib/brand/fonts";
import { renderLogo } from "@/lib/brand/logo";
import { refreshListingMeta } from "@/lib/listing/meta";
import { deleteProject, getProject, updateProject, type ProjectUpdate } from "@/lib/db/projects";
import { getProjectView } from "@/lib/db/views";
import { sanitizeListingHtml } from "@/lib/html/sanitize";
import { projectDir } from "@/lib/security/paths";
import {
  BrandKit,
  ListingMeta,
  ProductAnalysis,
  ProductListing,
  ProjectInputs,
  SourceExtraction,
  StoreContent,
  type WizardStep,
} from "@/lib/schemas";

import { finalizeContent } from "@/lib/pipeline/content";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PatchBody = z
  .object({
    name: z.string().min(1).max(120),
    inputs: ProjectInputs,
    rightsAccepted: z.boolean(),
    extractions: z.array(SourceExtraction).max(3),
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
  if (body.extractions !== undefined) {
    // Manual corrections to what was read from the source: the analysis is now out of date.
    update.extractions = body.extractions;
    if (JSON.stringify(body.extractions) !== JSON.stringify(current.extractions)) {
      update.changed!.push("input");
    }
  }
  if (body.analysis !== undefined) {
    update.analysis = body.analysis;
    // Acknowledging a risk flag doesn't change anything downstream steps consume.
    const facts = (a: typeof body.analysis | null) =>
      a &&
      JSON.stringify({ ...a, riskFlags: a.riskFlags.map((f) => ({ ...f, acknowledged: false })) });
    if (facts(body.analysis) !== facts(current.analysis)) touch("analysis");
  }
  if (body.brandKit !== undefined) {
    const kit = { ...body.brandKit };
    // Font availability and colour formats are decided here, not trusted from the client.
    if (kit.fonts) {
      kit.fonts = {
        heading: resolveFont(kit.fonts.heading.family),
        body: resolveFont(kit.fonts.body.family),
      };
    }
    if (kit.palette) {
      kit.palette = Object.fromEntries(
        Object.entries(kit.palette).map(([k, v]) => [k, normalizeHex(v)]),
      ) as typeof kit.palette;
    }
    const prev = current.brandKit;
    const logoInputs = (k: typeof kit | null) =>
      JSON.stringify([k?.selectedName, k?.fonts?.heading.family, k?.palette]);
    if (logoInputs(kit) !== logoInputs(prev) || (!kit.logoSvg && kit.palette && kit.fonts)) {
      const logo = await renderLogo(id, kit);
      kit.logoSvg = logo?.logoSvg ?? null;
      kit.logoPngPath = logo?.logoPngPath ?? null;
      kit.logoOutlined = logo?.logoOutlined ?? false;
    } else {
      // The logo files are server-generated; never accept paths from the client.
      kit.logoSvg = prev?.logoSvg ?? null;
      kit.logoPngPath = prev?.logoPngPath ?? null;
      kit.logoOutlined = prev?.logoOutlined ?? false;
    }
    update.brandKit = kit;
    if (JSON.stringify(kit) !== JSON.stringify(prev)) {
      if (kit.palette && kit.fonts && kit.selectedName) touch("brand");
      else update.changed!.push("brand");
    }
  }
  if (body.listingMeta !== undefined) update.listingMeta = body.listingMeta;
  if (body.listing !== undefined) {
    const listing = {
      ...body.listing,
      descriptionHtml: sanitizeListingHtml(body.listing.descriptionHtml),
    };
    update.listing = listing;
    // Placeholders and guardrail hits are derived server-side from what was saved.
    update.listingMeta = refreshListingMeta(listing, body.listingMeta ?? current.listingMeta);
    touch("listing");
  }
  if (body.content !== undefined) {
    // Sanitized and normalized server-side: menus, required pages and the review placeholder
    // are rebuilt from what was saved, whatever the client sent.
    update.content = finalizeContent(
      { ...current, listing: update.listing ?? current.listing },
      body.content,
    );
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
