/** Liveness check for hosting platforms; left outside the APP_PASSWORD gate. */
export function GET() {
  return Response.json({ ok: true });
}
