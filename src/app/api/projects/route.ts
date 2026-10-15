import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { createProject, listProjects } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

const CreateBody = z.object({ name: z.string().max(120).default("Untitled store") });

export const GET = route(async () => {
  const projects = await listProjects();
  return json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      steps: p.steps,
      brandName: p.brandKit?.selectedName ?? null,
      title: p.listing?.title ?? null,
    })),
  });
});

export const POST = route(async (req) => {
  const body = await parseBody(req, CreateBody);
  const project = await createProject(body.name);
  return json({ project }, 201);
});
