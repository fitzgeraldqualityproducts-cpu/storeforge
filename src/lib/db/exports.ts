import "server-only";
import type { ExportRecord as ExportRow } from "@/generated/prisma/client";
import { BundleOptions, ShopifyPushResult, ValidationReport } from "@/lib/schemas";
import { prisma } from "./client";

export function hydrateExport(row: ExportRow) {
  const parse = <T>(fn: (v: unknown) => T, raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return fn(JSON.parse(raw));
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as "bundle" | "shopify",
    createdAt: row.createdAt.toISOString(),
    artifactPath: row.artifactPath,
    fileName: row.artifactPath ? (row.artifactPath.split("/").pop() ?? null) : null,
    shopifyResult: parse((v) => ShopifyPushResult.parse(v), row.shopifyResult),
    validationReport: parse((v) => ValidationReport.parse(v), row.validationReport),
    options: parse((v) => BundleOptions.parse(v), row.options),
    publicExpiresAt: row.publicExpiresAt?.toISOString() ?? null,
    storeDomain: row.storeDomain,
  };
}
export type ExportView = ReturnType<typeof hydrateExport>;

export async function listExports(projectId: string) {
  const rows = await prisma.exportRecord.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map(hydrateExport);
}
