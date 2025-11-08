import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────── Logs helpers ─────────────── */
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
  platform?: string;       // "web" | "android" | "ios"
  device_id?: string;      // endpoint (web) ou device id (mobile)
  subscription?: any;      // webpush subscription JSON (web)
  fcm_token?: string;      // FCM token (mobile)
};

type Identity =
  | { mode: "supabase"; userId: string; studentId: null }
  | { mode: "parent";   userId: string; studentId: string };

/* ─────────────── Route ─────────────── */
export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const startedAt = new Date().toISOString();

  try {
    /* 🔐 Auth: priorité à l'auth Supabase (profs/admins), sinon cookie parent `psess` */
    const { data: { user: supaUser } } = await supa.auth.getUser().catch(() => ({ data: { user: null } as any }));
    let ident: Identity | null = null;

    if (supaUser?.id) {
      ident = { mode: "supabase", userId: supaUser.id, studentId: null };
    } else {
      const claims = readParentSessionFromReq(req); // { uid, sid, m, exp } ou null
      if (claims) ident = { mode: "parent", userId: claims.uid, studentId: claims.sid };
    }

    if (!ident) {
      log("auth_fail", { startedAt });
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", { mode: ident.mode, userId: shortId(ident.userId), studentId: ident.studentId ? shortId(ident.studentId) : null, startedAt });

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

    /* Plateforme */
    const platformRaw = String(body.platform || "").toLowerCase().trim();
    let platform = platformRaw;
    if (!platform) {
      if (body.subscription?.endpoint) platform = "web";
      else if (body.fcm_token) platform = "android";
    }
    log("platform_detect", { platformRaw, platform, hasSub: !!body.subscription, hasFcm: !!body.fcm_token });

    if (!["web", "android", "ios"].includes(platform)) {
      log("platform_invalid", { platform });
      return NextResponse.json({ error: "unknown_platform", stage: "preflight" }, { status: 400 });
    }

    /* Construction row à upserter */
    const now = new Date().toISOString();
    let deviceId = String(body.device_id || "").trim();
    const row: any = {
      user_id: ident.userId,
      platform,
      last_seen_at: now,
      // ⬇️ Important : si session parent → on enregistre aussi l'élève
      student_id: ident.mode === "parent" ? ident.studentId : null,
    };

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
      row.subscription_json = sub; // conserve l’objet tel quel (stringifiable côté PG)
    } else {
      const token = String(body.fcm_token || "").trim();
      log("fcm_preflight", { token: shortId(token) });
      if (!token) {
        return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      }
      row.fcm_token = token;
      row.device_id = deviceId || token;
    }

    /* Upsert principal
       NB: on garde le même onConflict → (user_id, platform, device_id)
       `student_id` est une info supplémentaire (indexée) mais non conflictuelle.
    */
    const onConflict = "user_id,platform,device_id";
    log("upsert_try", {
      onConflict,
      user_id: shortId(row.user_id),
      platform,
      device_id: shortId(row.device_id),
      student_id: row.student_id ? shortId(row.student_id) : null,
    });

    const up = await srv.from("push_subscriptions").upsert(row, { onConflict, ignoreDuplicates: false });

    if (up.error) {
      log("upsert_fail", { code: up.error.code, message: up.error.message, details: up.error.details, hint: up.error.hint });

      // Fallback UPDATE → INSERT si contrainte absente / problème onConflict
      const upd = await srv
        .from("push_subscriptions")
        .update(row)
        .match({ user_id: ident.userId, platform, device_id: row.device_id })
        .select("user_id");

      if (upd.error || !upd.data?.length) {
        if (upd.error) {
          log("update_fail", { code: upd.error.code, message: upd.error.message });
        } else {
          log("update_no_match", {});
        }

        const ins = await srv
          .from("push_subscriptions")
          .insert(row)
          .select("user_id");

        if (ins.error) {
          log("insert_fail", { code: ins.error.code, message: ins.error.message, details: ins.error.details, hint: ins.error.hint });
          return NextResponse.json({ error: ins.error.message, stage: "insert" }, { status: 400 });
        }

        log("insert_ok", { platform, device_id: shortId(row.device_id), student_id: row.student_id ? shortId(row.student_id) : null });
        return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id, student_id: row.student_id ?? null });
      }

      log("update_ok", { platform, device_id: shortId(row.device_id), student_id: row.student_id ? shortId(row.student_id) : null });
      return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id, student_id: row.student_id ?? null });
    }

    log("upsert_ok", { platform, device_id: shortId(row.device_id), student_id: row.student_id ? shortId(row.student_id) : null });
    return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id, student_id: row.student_id ?? null });
  } catch (e: any) {
    log("unhandled_error", { error: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
