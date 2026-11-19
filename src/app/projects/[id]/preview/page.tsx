import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FullPagePreview } from "@/components/wizard/full-page-preview";
import { findProject } from "@/lib/db/projects";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store preview" };

export default async function StorePreviewPage(props: PageProps<"/projects/[id]/preview">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const project = /^[a-zA-Z0-9-]{1,64}$/.test(id) ? await findProject(id) : null;
  if (!project) notFound();
  const raw = typeof sp.path === "string" ? sp.path : "/";
  const path = /^\/[\w\-/]*$/.test(raw) ? raw : "/";
  return <FullPagePreview projectId={id} initialPath={path} />;
}
