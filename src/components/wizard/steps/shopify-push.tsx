"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogOutIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  StoreIcon,
  UploadCloudIcon,
  XCircleIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, describeError } from "@/lib/client/api";
import type {
  JobView,
  ShopifyPushRequest,
  ShopifyPushResult,
  ShopifyStep,
  ShopifyStepResult,
} from "@/lib/schemas";
import { POLICY_SCOPES, REQUIRED_SCOPES } from "@/lib/shopify/scopes";
import { useJobRunning, useLastJob, useStartJob, useWizard } from "../context";

const JOBS = ["export_shopify"];
const SESSION_KEY = ["shopify-session"] as const;

interface SessionInfo {
  connected: boolean;
  domain: string | null;
  source: "session" | "env" | null;
  shopName?: string;
}

/** The push job's result payload (see runShopifyPush). */
interface PushJobResult {
  exportId: string | null;
  ok: boolean;
  failed: ShopifyStep[];
  result: ShopifyPushResult;
}

function jobResult(job: JobView | null): PushJobResult | null {
  const r = job?.result as PushJobResult | null | undefined;
  return r && typeof r === "object" && "result" in r ? r : null;
}

export function CustomAppGuide() {
  return (
    <details className="rounded-md border bg-background p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        How to get an Admin API access token (custom app)
      </summary>
      <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-muted-foreground">
        <li>
          In your Shopify admin, open{" "}
          <strong>Settings → Apps and sales channels → Develop apps</strong>. If asked, click{" "}
          <strong>Allow custom app development</strong>.
        </li>
        <li>
          Click <strong>Create an app</strong>, name it (e.g. &quot;StoreForge&quot;) and choose
          yourself as the developer.
        </li>
        <li>
          Open <strong>Configuration → Admin API integration → Configure</strong> and tick these
          scopes:
          <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs break-words">
            {REQUIRED_SCOPES.join(", ")}
          </code>
          To write Settings → Policies directly, also tick{" "}
          <code className="text-xs">{POLICY_SCOPES.join(", ")}</code> (without them, policies are
          saved as hidden pages).
        </li>
        <li>
          Save, then open <strong>API credentials → Install app</strong>.
        </li>
        <li>
          Under <strong>Admin API access token</strong>, click <strong>Reveal token once</strong>{" "}
          and copy it (it starts with <code className="text-xs">shpat_</code>). Shopify only shows
          it once.
        </li>
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        StoreForge keeps the token only for this browser session (encrypted cookie and server
        memory). It&apos;s never saved to disk or logged.
      </p>
    </details>
  );
}

function ConnectForm({ onConnected }: { onConnected: (s: SessionInfo) => void }) {
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const id = useId();
  const connect = useMutation({
    mutationFn: () =>
      api<SessionInfo>("/api/shopify/session", {
        method: "POST",
        json: { storeDomain: domain, accessToken: token },
      }),
    onSuccess: (s) => {
      setToken("");
      toast.success(`Connected to ${s.shopName ?? s.domain}`);
      onConnected(s);
    },
    onError: (e) => toast.error("Couldn't connect", { description: describeError(e) }),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        connect.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-domain`}>Store address</Label>
          <Input
            id={`${id}-domain`}
            placeholder="my-store.myshopify.com"
            autoComplete="off"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-token`}>Admin API access token</Label>
          <Input
            id={`${id}-token`}
            type="password"
            placeholder="shpat_…"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={connect.isPending || !domain || token.length < 10}>
          {connect.isPending ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
          Connect for this session
        </Button>
      </div>
    </form>
  );
}

const STATUS_BADGE: Record<
  ShopifyStepResult["status"],
  { label: string; variant: "success" | "destructive" | "outline" | "secondary" | "ember" }
> = {
  succeeded: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  planned: { label: "Planned", variant: "ember" },
  pending: { label: "Waiting", variant: "outline" },
  skipped: { label: "Skipped", variant: "secondary" },
};

function StepIcon({ status }: { status: ShopifyStepResult["status"] }) {
  if (status === "succeeded")
    return <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden="true" />;
  if (status === "failed")
    return <XCircleIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
  return <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function ResultsTable({
  steps,
  canRetry,
  onRetry,
  busy,
}: {
  steps: ShopifyStepResult[];
  canRetry: boolean;
  onRetry: (step: ShopifyStep) => void;
  busy: boolean;
}) {
  return (
    <div className="relative overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">Result of each push step</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Step
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Details
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => {
            const badge = STATUS_BADGE[s.status];
            return (
              <tr key={s.step} className="border-t align-top">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2 font-medium">
                    <StepIcon status={s.status} />
                    {s.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {s.detail ? <p>{s.detail}</p> : null}
                  {s.errors.map((e) => (
                    <p key={e} className="text-destructive">
                      {e}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-2 text-right">
                  {canRetry && s.status === "failed" && s.step !== "shop" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onRetry(s.step)}
                    >
                      <RotateCcwIcon /> Retry
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The dry run's plan, adjusted for the theme option as it is set now. */
function confirmOps(plan: ShopifyPushResult, includeTheme: boolean, themeName?: string) {
  const ops = plan.plannedOperations.filter((op) => includeTheme || !/theme/i.test(op));
  if (includeTheme && !ops.some((op) => /theme/i.test(op))) {
    ops.push(
      themeName
        ? `Write the theme files into the unpublished theme "${themeName}" (themeFilesUpsert)`
        : "Install a new unpublished copy of Dawn and write the theme files into it (themeCreate, themeFilesUpsert)",
    );
  }
  return ops;
}

export function ShopifyPushCard() {
  const { view, partials } = useWizard();
  const qc = useQueryClient();
  const start = useStartJob();
  const running = useJobRunning(JOBS);
  const last = useLastJob(JOBS);
  const [includeTheme, setIncludeTheme] = useState(false);
  const [themeId, setThemeId] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<SessionInfo>("/api/shopify/session"),
  });
  const disconnect = useMutation({
    mutationFn: () => api<SessionInfo>("/api/shopify/session", { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SESSION_KEY }),
  });

  const s = session.data;
  const lastResult = jobResult(last);
  const liveSteps = (partials.export_shopify as { steps?: ShopifyStepResult[] } | undefined)?.steps;
  const shownSteps = running && liveSteps ? liveSteps : (lastResult?.result.steps ?? null);
  const lastWasDry = lastResult?.result.dryRun ?? running;
  const dryRun =
    lastResult?.result.dryRun &&
    lastResult.result.storeDomain === s?.domain &&
    lastResult.result.steps.find((x) => x.step === "shop")?.status === "succeeded"
      ? lastResult.result
      : null;
  const pushRecord = view.exports.find(
    (e) => e.type === "shopify" && e.storeDomain === s?.domain && e.shopifyResult,
  );
  const productId = pushRecord?.shopifyResult?.resources.productId ?? null;
  const themes = dryRun?.themes ?? lastResult?.result.themes ?? [];

  const body = (extra: Partial<ShopifyPushRequest>): Partial<ShopifyPushRequest> => ({
    includeTheme,
    themeId: includeTheme && themeId ? themeId : null,
    ...extra,
  });
  const run = (extra: Partial<ShopifyPushRequest>) =>
    start.mutate({ path: "export/shopify", body: body(extra) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StoreIcon className="size-5" aria-hidden="true" /> Push to Shopify
        </CardTitle>
        <CardDescription>
          Creates the product (as a draft), images, inventory, collections, pages, policies and
          menus in your store through the Admin API. Run a dry run first to see exactly what will
          change.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {session.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking the connection…</p>
        ) : s?.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-accent/30 p-3">
            <div className="grid gap-0.5">
              <p className="text-xs text-muted-foreground">Connected store</p>
              <p className="font-mono text-base font-semibold break-all">{s.domain}</p>
              <p className="text-xs text-muted-foreground">
                {s.source === "env"
                  ? "From the server's SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN settings."
                  : "Token kept for this browser session only."}
              </p>
            </div>
            {s.source === "session" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending || running}
              >
                <LogOutIcon /> Disconnect
              </Button>
            ) : null}
          </div>
        ) : (
          <ConnectForm onConnected={(info) => qc.setQueryData(SESSION_KEY, info)} />
        )}
        <CustomAppGuide />

        {s?.connected ? (
          <>
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Theme (optional)</legend>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="push-theme"
                  checked={includeTheme}
                  onCheckedChange={(v) => setIncludeTheme(v === true)}
                />
                <Label htmlFor="push-theme" className="grid gap-0.5 font-normal">
                  <span className="text-sm font-medium">
                    Also write the Dawn theme files to an unpublished theme
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Your live theme is never changed. Preview the theme in Shopify and publish it
                    yourself.
                  </span>
                </Label>
              </div>
              {includeTheme ? (
                <div className="grid gap-1.5 md:max-w-md">
                  <Label htmlFor="push-theme-target">Write the theme files to</Label>
                  <select
                    id="push-theme-target"
                    className="h-9 rounded-md border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    value={themeId}
                    onChange={(e) => setThemeId(e.target.value)}
                  >
                    <option value="">A new copy of Dawn (installed from GitHub)</option>
                    {themes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.role.toLowerCase()})
                      </option>
                    ))}
                  </select>
                  {!themes.length ? (
                    <p className="text-xs text-muted-foreground">
                      Run a dry run to list your unpublished themes.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={running || start.isPending}
                onClick={() => run({ dryRun: true })}
              >
                {running && lastWasDry ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SearchCheckIcon />
                )}
                Dry run (changes nothing)
              </Button>
              <Button
                variant="ember"
                disabled={running || start.isPending || !dryRun}
                onClick={() => setConfirmOpen(true)}
              >
                <UploadCloudIcon /> Push to Shopify…
              </Button>
              {!dryRun && !running ? (
                <p className="text-xs text-muted-foreground">Run a dry run for this store first.</p>
              ) : null}
              {running && last ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {last.message}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {last?.status === "failed" && last.error ? (
          <Alert variant="destructive">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertTitle>The push stopped</AlertTitle>
            <AlertDescription>{last.error}</AlertDescription>
          </Alert>
        ) : null}

        {shownSteps ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                {lastWasDry ? "Dry run: what would happen" : "Push results"}
                {lastResult ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {lastResult.result.storeDomain}
                  </span>
                ) : null}
              </h3>
              {productId && s?.domain ? (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`https://admin.shopify.com/store/${s.domain.replace(/\.myshopify\.com$/, "")}/products/${productId.split("/").pop()}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the product in Shopify <ExternalLinkIcon />
                  </a>
                </Button>
              ) : null}
            </div>
            {lastResult?.result.warnings.length ? (
              <Alert variant="warning">
                <AlertTriangleIcon aria-hidden="true" />
                <AlertTitle>Check before you go live</AlertTitle>
                <AlertDescription>
                  <ul className="grid list-disc gap-1 pl-4">
                    {lastResult.result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <ResultsTable
              steps={shownSteps}
              canRetry={!lastWasDry && lastResult?.result.storeDomain === s?.domain}
              busy={running || start.isPending}
              onRetry={(step) => run({ dryRun: false, confirm: true, onlySteps: [step] })}
            />
            {lastWasDry && dryRun?.plannedOperations.length ? (
              <details className="rounded-md border bg-background p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  Planned operations ({dryRun.plannedOperations.length})
                </summary>
                <ol className="mt-2 grid list-decimal gap-1 pl-5 text-muted-foreground">
                  {dryRun.plannedOperations.map((op) => (
                    <li key={op}>{op}</li>
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Push to this store?</DialogTitle>
            <DialogDescription>
              These changes will be made in your Shopify store. The product is created as a draft,
              so nothing is for sale until you make it active.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border-2 border-ember bg-accent/40 p-3 text-center">
            <p className="text-xs text-muted-foreground">Store</p>
            <p className="font-mono text-lg font-semibold break-all">{s?.domain}</p>
            {dryRun?.shopName ? <p className="text-sm">{dryRun.shopName}</p> : null}
          </div>
          {dryRun ? (
            <ol className="grid max-h-64 list-decimal gap-1.5 overflow-y-auto pl-5 text-sm">
              {confirmOps(dryRun, includeTheme, themes.find((t) => t.id === themeId)?.name).map(
                (op) => (
                  <li key={op}>{op}</li>
                ),
              )}
            </ol>
          ) : null}
          {dryRun?.warnings.length ? (
            <ul className="grid list-disc gap-1 pl-5 text-sm text-destructive">
              {dryRun.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="ember"
              disabled={start.isPending}
              onClick={() => {
                setConfirmOpen(false);
                run({ dryRun: false, confirm: true });
              }}
            >
              <UploadCloudIcon /> Push to {s?.domain}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
