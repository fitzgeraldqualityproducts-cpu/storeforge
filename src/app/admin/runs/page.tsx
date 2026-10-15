import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Debug runs" };

/** Dev-only debug page: recent jobs, AI calls (tokens/latency) and errors. */
export default async function RunsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [jobs, calls, totals] = await Promise.all([
    prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.aiCall.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.aiCall.aggregate({ _sum: { inputTokens: true, outputTokens: true }, _count: true }),
  ]);
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="font-display text-4xl">Debug runs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Development only. {totals._count} AI calls · {totals._sum.inputTokens ?? 0} input tokens ·{" "}
        {totals._sum.outputTokens ?? 0} output tokens.
      </p>
      <h2 className="mt-8 mb-3 text-lg font-semibold">Jobs</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Message / error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t align-top">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {j.createdAt.toISOString().slice(0, 19)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{j.projectId.slice(0, 8)}</td>
                <td className="px-3 py-2">{j.type}</td>
                <td className="px-3 py-2">
                  <Badge
                    variant={
                      j.status === "failed"
                        ? "destructive"
                        : j.status === "succeeded"
                          ? "success"
                          : "secondary"
                    }
                  >
                    {j.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{j.attempts}</td>
                <td className="px-3 py-2 tabular-nums">
                  {j.startedAt && j.finishedAt
                    ? `${((+j.finishedAt - +j.startedAt) / 1000).toFixed(1)}s`
                    : "—"}
                </td>
                <td className="max-w-md px-3 py-2 break-words">{j.error ?? j.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold">AI calls</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Tokens in/out</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {c.createdAt.toISOString().slice(0, 19)}
                </td>
                <td className="px-3 py-2">{c.task}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.model}</td>
                <td className="px-3 py-2">{c.mode}</td>
                <td className="px-3 py-2 tabular-nums">
                  {c.inputTokens}/{c.outputTokens}
                </td>
                <td className="px-3 py-2 tabular-nums">{(c.latencyMs / 1000).toFixed(1)}s</td>
                <td className="px-3 py-2 tabular-nums">{c.attempts}</td>
                <td className="max-w-md px-3 py-2 break-words">
                  {c.success ? (
                    <Badge variant="success">ok</Badge>
                  ) : (
                    <span className="text-destructive">{c.error}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
