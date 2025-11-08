import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function shortId(x: unknown, n = 16) {
  const s = String(x ?? "");
  return !s ? s : s.length <= n ? s : `${s.slice(0, Math.max(4, n/2))}…${s.slice(-Math.max(4, n/2))}`;
}

export async function POST(req: NextRequest) {
  const claims = readParentSessionFromReq(req);
  if (!claims?.sid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const student_id = claims.sid;

  const srv = getSupabaseServiceClient();

  let body: any = null;
  try { body = await req.json(); } catch { /* noop */ }
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  let platform = String(body.platform || "").toLowerCase().trim();
  if (!platform) {
    if (body.subscription?.endpoint) platform = "web";
    else if (body.fcm_token) platform = "android";
  }
  if (!["web","android","ios"].includes(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 400 });
  }

  const now = new Date().toISOString();
  let device_id = String(body.device_id || "").trim();
  const row: any = { student_id, platform, last_seen_at: now };

  if (platform === "web") {
    const sub = body.subscription;
    const ok = !!sub?.endpoint && !!sub?.keys?.p256dh && !!sub?.keys?.auth;
    if (!ok) return NextResponse.json({ error: "missing_or_invalid_subscription" }, { status: 400 });
    device_id = device_id || String(sub.endpoint);
    row.device_id = device_id;
    row.subscription_json = sub;
  } else {
    const token = String(body.fcm_token || "").trim();
    if (!token) return NextResponse.json({ error: "missing_fcm_token" }, { status: 400 });
    row.fcm_token = token;
    row.device_id = device_id || token;
  }

  // UPSERT (fallback update→insert)
  const onConflict = "student_id,platform,device_id";
  const up = await srv.from("push_subscriptions_student").upsert(row, { onConflict });
  if (up.error) {
    const upd = await srv.from("push_subscriptions_student")
      .update(row)
      .match({ student_id, platform, device_id: row.device_id })
      .select("student_id");
    if (upd.error || !upd.data?.length) {
      const ins = await srv.from("push_subscriptions_student").insert(row).select("student_id");
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id });
    }
    return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id });
  }
  return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id });
}
