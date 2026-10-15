import { notFound } from "next/navigation";
import { Wizard } from "@/components/wizard/wizard";
import { publicCapabilities } from "@/lib/config";
import { findProject } from "@/lib/db/projects";
import { WizardStep } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const project = /^[a-zA-Z0-9-]{1,64}$/.test(id) ? await findProject(id) : null;
  if (!project) notFound();
  const step = WizardStep.safeParse(sp.step);
  return (
    <Wizard
      projectId={id}
      initialStep={step.success ? step.data : "input"}
      capabilities={publicCapabilities()}
    />
  );
}
