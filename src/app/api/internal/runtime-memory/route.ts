import { runtimeMemorySample } from "@/lib/runtime-memory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return Response.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true, ...runtimeMemorySample() }, { headers: { "Cache-Control": "no-store" } });
}
