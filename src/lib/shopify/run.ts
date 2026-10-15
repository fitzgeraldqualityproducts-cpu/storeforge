import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "@/lib/config";
import { prisma } from "@/lib/db/client";
import { hydrateExport } from "@/lib/db/exports";
import { getProject, updateProject } from "@/lib/db/projects";
import { UserFacingError } from "@/lib/errors";
import { exportImageName, processedAssets, requireReady } from "@/lib/export/bundle";
import { buildDawnTheme } from "@/lib/export/theme";
import type { JobContext } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import { SHOPIFY_STEPS, ShopifyPushRequest, type ShopifyPushResult } from "@/lib/schemas";
import { fromDataRelative } from "@/lib/security/paths";
import { createAdminClient } from "./client";
import { DEFAULT_DAWN_SOURCE, pushToShopify, type PushImage } from "./push";
import { clearForJob, credentialsForJob } from "./session";

/** What the route stores in the job row: options and the store domain, never the token. */
export const ShopifyJobPayload = ShopifyPushRequest.extend({
  storeDomain: z.string(),
});
export type ShopifyJobPayload = z.infer<typeof ShopifyJobPayload>;

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Job handler for "export_shopify": dry-run or live push, with per-step progress. */
export async function runShopifyPush(ctx: JobContext) {
  const payload = ShopifyJobPayload.parse(ctx.payload);
  const creds = credentialsForJob(ctx.projectId, payload.storeDomain);
  if (!creds) {
    throw new UserFacingError(
      `The Shopify session for ${payload.storeDomain} has ended (tokens are only kept in memory). Enter the access token again and retry.`,
    );
  }
  try {
    const at = (f: number) => f * 100;
    await ctx.progress(
      "shopify",
      at(0.02),
      payload.dryRun ? "Checking the plan" : "Preparing images",
    );
    let project = await getProject(ctx.projectId);
    requireReady(project);
    const assets = await processedAssets(ctx, (f) => at(f * 0.2));
    project = await getProject(ctx.projectId);
    const { listing, content, brand } = requireReady(project);
    const storeName = content.settings.storeName || brand.selectedName || project.name;

    const images: PushImage[] = await Promise.all(
      assets.map(async (a, i) => {
        const file = fromDataRelative(a.processedPath!);
        const data = await readFile(file);
        return {
          assetId: a.id,
          fileName: exportImageName(listing.handle, i + 1),
          alt: a.altText,
          variantKey: a.variantKey,
          mimeType: "image/webp",
          size: data.length,
          read: async () => data,
        };
      }),
    );
    const theme = buildDawnTheme({ brand, content, listing });
    const themeFiles = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, json(v)]));

    const previousRow = await prisma.exportRecord.findFirst({
      where: { projectId: ctx.projectId, type: "shopify", storeDomain: creds.domain },
      orderBy: { createdAt: "desc" },
    });
    const previous = previousRow ? hydrateExport(previousRow).shopifyResult : null;
    let recordId = previousRow?.id ?? null;

    const e = env();
    const client = createAdminClient({
      domain: creds.domain,
      token: creds.token,
      apiVersion: e.SHOPIFY_API_VERSION,
    });

    const persist = async (result: ShopifyPushResult) => {
      if (payload.dryRun) return;
      const data = { shopifyResult: JSON.stringify(result), storeDomain: creds.domain };
      if (recordId) {
        await prisma.exportRecord.update({ where: { id: recordId }, data });
      } else {
        recordId = randomUUID();
        await prisma.exportRecord.create({
          data: { id: recordId, projectId: ctx.projectId, type: "shopify", ...data },
        });
      }
    };

    const result = await pushToShopify(
      client,
      { listing, content, storeName, images, themeFiles },
      {
        dryRun: payload.dryRun,
        includeTheme: payload.includeTheme,
        themeId: payload.themeId,
        onlySteps: payload.onlySteps,
        themeSourceUrl: e.SHOPIFY_THEME_SOURCE_URL ?? DEFAULT_DAWN_SOURCE,
        onUpdate: async (r, step) => {
          await persist(r);
          const done = SHOPIFY_STEPS.indexOf(step) + 1;
          const s = r.steps.find((x) => x.step === step)!;
          await ctx.progress(
            "shopify",
            at(0.2 + 0.8 * (done / SHOPIFY_STEPS.length)),
            `${s.label}: ${s.status}`,
            { steps: r.steps },
          );
        },
      },
      previous
        ? { resources: previous.resources, steps: payload.onlySteps ? previous.steps : null }
        : null,
    );
    await persist(result);

    const failed = result.steps.filter((s) => s.status === "failed").map((s) => s.step);
    if (!payload.dryRun) {
      log.info("shopify.push", { projectId: ctx.projectId, domain: creds.domain, failed });
      if (!failed.length) {
        await updateProject(ctx.projectId, {
          status: "exported",
          steps: { export: { status: "ready", updatedAt: new Date().toISOString(), error: null } },
        });
      }
    }
    await ctx.progress(
      "shopify",
      100,
      payload.dryRun
        ? "Dry run finished: nothing was changed"
        : failed.length
          ? `Pushed with ${failed.length} failed step${failed.length === 1 ? "" : "s"}`
          : "Pushed to Shopify",
    );
    return { exportId: recordId, ok: failed.length === 0, failed, result };
  } finally {
    clearForJob(ctx.projectId);
  }
}
