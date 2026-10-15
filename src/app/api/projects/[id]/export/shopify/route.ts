import { HttpError, json, parseBody, rateLimit, route } from "@/lib/api";
import { getProject } from "@/lib/db/projects";
import { assertInputsReady } from "@/lib/jobs/start";
import { enqueueJob } from "@/lib/jobs/runner";
import { ShopifyPushRequest } from "@/lib/schemas";
import { POLICIES } from "@/lib/security/rate-limit";
import { resolveCredentials, stashForJob } from "@/lib/shopify/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push the store to Shopify (or dry-run it). A live push needs `confirm: true`, which the UI
 * only sends from the confirmation dialog that names the store. The token is handed to the
 * job in memory; the job row only stores the options and the store domain.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  rateLimit(req, "export", POLICIES.export);
  const body = await parseBody(req, ShopifyPushRequest);
  const project = await getProject(id);
  await assertInputsReady(project);
  if (!project.listing || !project.content) {
    throw new HttpError(422, "Finish the product listing and store content before pushing.");
  }
  const creds = resolveCredentials(req);
  if (!creds) {
    throw new HttpError(
      422,
      "Connect a Shopify store first: enter its myshopify.com address and an Admin API access token.",
    );
  }
  if (!body.dryRun && !body.confirm) {
    throw new HttpError(
      422,
      `Confirm the push: this creates and updates resources in ${creds.domain}.`,
    );
  }
  stashForJob(id, creds);
  const job = await enqueueJob(id, "export_shopify", { ...body, storeDomain: creds.domain });
  return json({ job, storeDomain: creds.domain }, 202);
});
