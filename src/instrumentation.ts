/**
 * Runs once when the Next.js server starts: resumes interrupted jobs and schedules the
 * data-retention cleanup. Only in the Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startRunner } = await import("./lib/jobs/runner");
  const { scheduleCleanup } = await import("./lib/maintenance/cleanup");
  await startRunner();
  scheduleCleanup();
}
