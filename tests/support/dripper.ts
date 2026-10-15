import { readFileSync } from "node:fs";
import path from "node:path";
import { createProject, getProject, updateProject } from "@/lib/db/projects";
import { ingestImage } from "@/lib/images/ingest";
import { parseProductHtml } from "@/lib/scrape/parse";
import { SourceExtraction } from "@/lib/schemas";

/** A project built from the fixture product page (pour-over dripper) plus its 3 photos. */
export async function dripperProject(name: string) {
  const p = await createProject(name);
  const html = readFileSync(path.join(__dirname, "../fixtures/site/product.html"), "utf8");
  const parsed = parseProductHtml(html, "https://shop.example/product.html");
  await updateProject(p.id, {
    inputs: {
      urls: ["https://shop.example/product.html"],
      context: { ...(await getProject(p.id)).inputs.context, tone: "Cozy" },
    },
    extractions: [
      SourceExtraction.parse({
        ...parsed,
        url: "https://shop.example/product.html",
        sourceDomain: "shop.example",
        fetchMethod: "static",
        fetchedAt: new Date().toISOString(),
      }),
    ],
  });
  for (const n of [1, 2, 3]) {
    await ingestImage(
      p.id,
      readFileSync(path.join(__dirname, `../fixtures/site/images/dripper-${n}.jpg`)),
      { origin: "upload" },
    );
  }
  return p;
}
