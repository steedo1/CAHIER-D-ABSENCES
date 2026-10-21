import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { closeAttendanceBatch, SERVER_CLOSE_BATCH_SIZE, SERVER_CLOSE_LOOKBACK_MS } from "@/lib/attendance-server-close";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const expected = (process.env.CRON_SECRET || "").trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1]?.trim() || "";
  const supplied = (req.headers.get("x-cron-secret") || bearer).trim();
  const expectedBytes = Buffer.from(expected), suppliedBytes = Buffer.from(supplied);
  return !!expected && suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Read-only by default. No schedule or activation is installed by this PR. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const requested = req.nextUrl.searchParams.get("apply") === "1";
  const enabled = process.env.ATTENDANCE_SERVER_CLOSE_ENABLED === "true";
  if (requested && !enabled) {
    return NextResponse.json({ ok: false, error: "attendance_server_close_not_enabled" }, { status: 409 });
  }
  const now = Date.now();
  const service = getSupabaseServiceClient();
  const { data, error } = await service.from("teacher_sessions")
    .select("id,institution_id,started_at,expected_minutes,ended_at,status")
    .is("ended_at", null).eq("status", "open")
    .gt("expected_minutes", 0).lte("expected_minutes", 1440)
    .gte("started_at", new Date(now - SERVER_CLOSE_LOOKBACK_MS).toISOString())
    .lte("started_at", new Date(now).toISOString())
    .order("started_at", { ascending: true }).limit(SERVER_CLOSE_BATCH_SIZE);
  if (error) return NextResponse.json({ ok: false, error: "attendance_close_read_failed" }, { status: 503 });
  try {
    const result = await closeAttendanceBatch({ rows: data || [], now, apply: requested && enabled,
      table: () => service.from("teacher_sessions") });
    return NextResponse.json({ ok: true, dry_run: !requested, scanned: data?.length || 0,
      batch_limit_reached: data?.length === SERVER_CLOSE_BATCH_SIZE, ...result },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Report ambiguous partial failure; never replay a POST automatically.
    return NextResponse.json({ ok: false, error: "attendance_close_write_failed" }, { status: 503 });
  }
}
