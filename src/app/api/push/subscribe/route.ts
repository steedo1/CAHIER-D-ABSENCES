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

/* ─────────── helper parent_device → parent_profile_id ─────────── */
async function ensureParentProfileForDevice(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string
): Promise<string | null> {
  // 1) RPC si dispo
  try {
    const { data } = await (srv as any).rpc("ensure_parent_profile", { p_device: deviceId }).single();
    const got = data?.ensure_parent_profile || data?.parent_profile_id || data?.parent_id || data;
    if (got) return String(got);
  } catch { /* ignore */ }

  // 2) Fallback table parent_devices
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
    /* Auth: on PRÉFÈRE le cookie parent_device (flux “matricule”) ; sinon user supabase */
    const jar = await cookies(); // ← IMPORTANT: cookies() est async dans Next 15
    const parentDevice = jar.get("parent_device")?.value || "";
    let parentUserId: string | null = null;

    if (parentDevice) {
      parentUserId = await ensureParentProfileForDevice(srv, parentDevice);
    }

    const { data: { user } } = await supa.auth.getUser();
    const userId = parentUserId || user?.id || null;

    if (!userId) {
      log("auth_fail", { startedAt, hasCookie: !!parentDevice });
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", { userId, startedAt, hasCookie: !!parentDevice, hasSupabaseUser: !!user?.id });

    /* Body parsing */
    let body: Body | null = null;
    try {
      body = await req.json();
    } catch (e: any) {
      log("parse_fail", { error: String(e?.message || e) });
      return NextResponse.json({ error: "invalid_json", stage: "parse" }, { status: 400 });
    }
    if (!body) {
      log("parse_empty", {});
      return NextResponse.json({ error: "empty_body", stage: "parse" }, { status: 400 });
    }

    /* Plateforme déduite */
    const platformRaw = String(body.platform || "").toLowerCase().trim();
    let platform = platformRaw;
    if (!platform) {
      if (body.subscription?.endpoint) platform = "web";
      else if (body.fcm_token) platform = "android"; // iOS via FCM → "ios" accepté aussi
    }
    log("platform_detect", { platformRaw, platform, hasSub: !!body.subscription, hasFcm: !!body.fcm_token });

    if (!["web", "android", "ios"].includes(platform)) {
      log("platform_invalid", { platform });
      return NextResponse.json({ error: "unknown_platform", stage: "preflight" }, { status: 400 });
    }

    /* Construction de la row à upserter */
    const now = new Date().toISOString();
    let deviceId = String(body.device_id || "").trim();
    const row: any = { user_id: userId, platform, last_seen_at: now };

    if (platform === "web") {
      const sub = body.subscription;
      const ok = !!sub?.endpoint && !!sub?.keys?.p256dh && !!sub?.keys?.auth;
      log("web_preflight", {
        endpoint: shortId(sub?.endpoint),
        hasP256: !!sub?.keys?.p256dh,
        hasAuth: !!sub?.keys?.auth,
      });
      if (!ok) {
        return NextResponse.json({ error: "missing_or_invalid_subscription", stage: "preflight" }, { status: 400 });
      }
      deviceId = deviceId || String(sub.endpoint);
      row.device_id = deviceId;
      row.subscription_json = sub; // on stocke l'objet tel quel
    } else {
      const token = String(body.fcm_token || "").trim();
      log("fcm_preflight", { token: shortId(token) });
      if (!token) {
        return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      }
      row.fcm_token = token;
      row.device_id = deviceId || token;
    }

    /* Upsert principal: onConflict + fallback update/insert */
    const onConflict = "user_id,platform,device_id";
    log("upsert_try", { onConflict, user_id: userId, platform, device_id: shortId(row.device_id) });

    const up = await srv
      .from("push_subscriptions")
      .upsert(row, { onConflict, ignoreDuplicates: false });

    if (up.error) {
      log("upsert_fail", { code: up.error.code, message: up.error.message, details: up.error.details, hint: up.error.hint });

      const upd = await srv
        .from("push_subscriptions")
        .update(row)
        .match({ user_id: userId, platform, device_id: row.device_id })
        .select("user_id");

      if (upd.error || !upd.data?.length) {
        if (upd.error) {
          log("update_fail", { code: upd.error.code, message: upd.error.message });
        } else {
          log("update_no_match", {});
        }

        const ins = await srv
          .from("push_subscriptions")
          .insert({ ...row, user_id: userId })
          .select("user_id");

        if (ins.error) {
          log("insert_fail", { code: ins.error.code, message: ins.error.message, details: ins.error.details, hint: ins.error.hint });
          return NextResponse.json({ error: ins.error.message, stage: "insert" }, { status: 400 });
        }

        log("insert_ok", { platform, device_id: shortId(row.device_id) });
        return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id });
      }

      log("update_ok", { platform, device_id: shortId(row.device_id) });
      return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id });
    }

    log("upsert_ok", { platform, device_id: shortId(row.device_id) });
    return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id });
  } catch (e: any) {
    log("unhandled_error", { error: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
