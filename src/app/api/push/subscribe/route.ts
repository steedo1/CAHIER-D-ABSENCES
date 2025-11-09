// src/app/api/push/subscribe/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────── Logs ─────────────── */
const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
function shortId(x: unknown, n = 16) {
  const s = String(x ?? "");
  if (!s) return s;
  return s.length <= n ? s : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(-Math.max(4, Math.floor(n / 2)))}`;
}
function log(stage: string, meta: Record<string, unknown>) {
  if (VERBOSE) console.info(`[push/subscribe] ${stage}`, meta);
}

/* ─────────────── Types ─────────────── */
type Body = {
  platform?: string;   // "web" | "android" | "ios"
  device_id?: string;  // endpoint (web) ou device id (mobile)
  subscription?: any;  // webpush subscription JSON
  fcm_token?: string;  // FCM token (android/ios)
};

async function ensureParentProfileForDevice(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string
): Promise<string | null> {
  try {
    const { data } = await (srv as any).rpc("ensure_parent_profile", { p_device: deviceId }).single();
    const got = data?.ensure_parent_profile || data?.parent_profile_id || data?.parent_id || data;
    if (got) return String(got);
  } catch { /* ignore */ }

  try {
    const { data: row } = await srv
      .from("parent_devices")
      .select("parent_profile_id")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (row?.parent_profile_id) return String(row.parent_profile_id);
  } catch { /* ignore */ }

  return null;
}

/* ─────────────── Route ─────────────── */
export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const startedAt = new Date().toISOString();

  try {
    // ✅ await cookies() (selon vos types Next)
    const jar = await cookies();
    const parentDevice = jar.get("parent_device")?.value || "";
    let parentUserId: string | null = null;
    if (parentDevice) parentUserId = await ensureParentProfileForDevice(srv, parentDevice);

    const { data: { user } } = await supa.auth.getUser();
    const userId = parentUserId || user?.id || null;

    if (!userId) {
      log("auth_fail", { startedAt, hasCookie: !!parentDevice });
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", { userId, startedAt, hasCookie: !!parentDevice, hasSupabaseUser: !!user?.id });

    // Body
    let body: Body | null = null;
    try { body = await req.json(); }
    catch (e: any) {
      log("parse_fail", { error: String(e?.message || e) });
      return NextResponse.json({ error: "invalid_json", stage: "parse" }, { status: 400 });
    }
    if (!body) return NextResponse.json({ error: "empty_body", stage: "parse" }, { status: 400 });

    // Plateforme
    const platformRaw = String(body.platform || "").toLowerCase().trim();
    let platform = platformRaw;
    if (!platform) {
      if (body.subscription?.endpoint) platform = "web";
      else if (body.fcm_token) platform = "android";
    }
    if (!["web", "android", "ios"].includes(platform)) {
      return NextResponse.json({ error: "unknown_platform", stage: "preflight" }, { status: 400 });
    }

    // Row
    const now = new Date().toISOString();
    let deviceId = String(body.device_id || "").trim();
    const row: any = { user_id: userId, platform, last_seen_at: now };

    if (platform === "web") {
      const sub = body.subscription;
      const ok = !!sub?.endpoint && !!sub?.keys?.p256dh && !!sub?.keys?.auth;
      if (!ok) return NextResponse.json({ error: "missing_or_invalid_subscription", stage: "preflight" }, { status: 400 });
      deviceId = deviceId || String(sub.endpoint);
      row.device_id = deviceId;
      row.subscription_json = sub;
    } else {
      const token = String(body.fcm_token || "").trim();
      if (!token) return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      row.fcm_token = token;
      row.device_id = deviceId || token;
    }

    // Upsert + fallbacks
    const onConflict = "user_id,platform,device_id";
    const up = await srv.from("push_subscriptions").upsert(row, { onConflict, ignoreDuplicates: false });

    if (up.error) {
      const upd = await srv
        .from("push_subscriptions")
        .update(row)
        .match({ user_id: userId, platform, device_id: row.device_id })
        .select("user_id");

      if (upd.error || !upd.data?.length) {
        const ins = await srv.from("push_subscriptions").insert({ ...row, user_id: userId }).select("user_id");
        if (ins.error) return NextResponse.json({ error: ins.error.message, stage: "insert" }, { status: 400 });
        return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id });
      }
      return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id });
    }

    return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id });
  } catch (e: any) {
    log("unhandled_error", { error: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
