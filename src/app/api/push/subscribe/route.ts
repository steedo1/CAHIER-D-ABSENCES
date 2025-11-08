// src/app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
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
  | { mode: "parent";   userId: string; studentId: string }
  | { mode: "device";   deviceId: string; studentIds: string[] };

/* ─────────────── Helpers ─────────────── */

function detectPlatform(body: Body): "web" | "android" | "ios" | "unknown" {
  const raw = String(body.platform || "").toLowerCase().trim();
  if (raw === "web" || raw === "android" || raw === "ios") return raw as any;
  if (body.subscription?.endpoint) return "web";
  if (body.fcm_token) return "android";
  return "unknown";
}

function validWebSub(sub: any) {
  return !!(sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth);
}

async function upsertParentRow(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
  platform: "web" | "android" | "ios",
  deviceId: string,
  sub: any,
  fcm: string | null,
  studentId: string | null, // si mode "parent", on renseigne aussi l'élève lié
) {
  const now = new Date().toISOString();
  const row: any = {
    user_id: userId,
    platform,
    device_id: deviceId,
    last_seen_at: now,
    subscription_json: platform === "web" ? sub : null,
    fcm_token: platform !== "web" ? fcm : null,
    student_id: studentId, // nullable ; info supplémentaire utile pour filtres/diagnostics
  };

  const onConflict = "user_id,platform,device_id";
  log("upsert_parent_try", { user_id: shortId(userId), platform, device_id: shortId(deviceId) });

  const up = await srv.from("push_subscriptions").upsert(row, { onConflict, ignoreDuplicates: false });
  if (!up.error) return { ok: true, mode: "upsert" as const };

  log("upsert_parent_fail", { code: up.error.code, message: up.error.message, details: up.error.details, hint: up.error.hint });

  const upd = await srv
    .from("push_subscriptions")
    .update(row)
    .match({ user_id: userId, platform, device_id: deviceId })
    .select("user_id");

  if (!upd.error && upd.data?.length) return { ok: true, mode: "update" as const };

  if (upd.error) log("update_parent_fail", { code: upd.error.code, message: upd.error.message });

  const ins = await srv.from("push_subscriptions").insert(row).select("user_id");
  if (ins.error) {
    log("insert_parent_fail", { code: ins.error.code, message: ins.error.message, details: ins.error.details, hint: ins.error.hint });
    return { ok: false, error: ins.error.message, stage: "insert_parent" as const };
  }
  return { ok: true, mode: "insert" as const };
}

async function upsertStudentRows(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  studentIds: string[],
  platform: "web" | "android" | "ios",
  deviceId: string,
  sub: any,
  fcm: string | null,
) {
  const now = new Date().toISOString();
  const rows = studentIds.map((sid) => ({
    student_id: sid,
    platform,
    device_id: deviceId,
    last_seen_at: now,
    subscription_json: platform === "web" ? sub : null,
    fcm_token: platform !== "web" ? fcm : null,
  }));

  const onConflict = "student_id,platform,device_id";
  log("upsert_students_try", {
    count: rows.length,
    platform,
    sample: rows.slice(0, 3).map((r) => ({ student_id: shortId(r.student_id), device_id: shortId(r.device_id) })),
  });

  const up = await srv.from("push_subscriptions_student").upsert(rows, { onConflict, ignoreDuplicates: false });
  if (!up.error) return { ok: true, mode: "upsert" as const, count: rows.length };

  log("upsert_students_fail", { code: up.error.code, message: up.error.message, details: up.error.details, hint: up.error.hint });

  // Fallback UPDATE puis INSERT unitaire (en cas de contrainte absente)
  let done = 0;
  for (const r of rows) {
    const upd = await srv
      .from("push_subscriptions_student")
      .update(r)
      .match({ student_id: r.student_id, platform: r.platform, device_id: r.device_id })
      .select("student_id");

    if (!upd.error && upd.data?.length) {
      done++;
      continue;
    }

    const ins = await srv.from("push_subscriptions_student").insert(r).select("student_id");
    if (!ins.error) done++;
  }

  return { ok: true, mode: "mixed" as const, count: done };
}

/* ─────────────── Route ─────────────── */
export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const startedAt = new Date().toISOString();

  try {
    /* 1) Déterminer l’identité parmi 3 modes :
       - "supabase": user authentifié (prof/admin/parent classique)
       - "parent":   cookie `psess` (JWT parent)
       - "device":   cookie `parent_device` (nouveau flow “matricule only”)
    */
    let ident: Identity | null = null;

    const { data: { user: supaUser } } = await supa.auth.getUser().catch(() => ({ data: { user: null } as any }));
    if (supaUser?.id) {
      ident = { mode: "supabase", userId: supaUser.id, studentId: null };
    } else {
      const claims = readParentSessionFromReq(req); // { uid, sid, m, exp } | null
      if (claims) {
        ident = { mode: "parent", userId: claims.uid, studentId: claims.sid };
      } else {
        // Nouveau : essayer le cookie device → tous les enfants de ce device
        const jar = await cookies();
        const deviceId = jar.get("parent_device")?.value || "";
        if (deviceId) {
          const { data: links, error: linkErr } = await srv
            .from("parent_device_children")
            .select("student_id")
            .eq("device_id", deviceId);

          const studentIds = (links || []).map((r) => String(r.student_id)).filter(Boolean);
          if (linkErr) log("device_links_fail", { error: linkErr.message, deviceId: shortId(deviceId) });
          if (studentIds.length) {
            ident = { mode: "device", deviceId, studentIds };
          }
        }
      }
    }

    if (!ident) {
      log("auth_fail", { startedAt });
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", {
      mode: ident.mode,
      userId: (ident as any).userId ? shortId((ident as any).userId) : null,
      studentId: (ident as any).studentId ? shortId((ident as any).studentId) : null,
      deviceId: (ident as any).deviceId ? shortId((ident as any).deviceId) : null,
      countKids: (ident as any).studentIds?.length ?? null,
      startedAt
    });

    /* 2) Body */
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

    /* 3) Plateforme + préflights */
    const platform = detectPlatform(body);
    log("platform_detect", { platform, hasSub: !!body.subscription, hasFcm: !!body.fcm_token });

    if (platform === "unknown") {
      return NextResponse.json({ error: "unknown_platform", stage: "preflight" }, { status: 400 });
    }

    let deviceId = String(body.device_id || "").trim();
    let sub: any = null;
    let fcm: string | null = null;

    if (platform === "web") {
      sub = body.subscription;
      if (!validWebSub(sub)) {
        return NextResponse.json({ error: "missing_or_invalid_subscription", stage: "preflight" }, { status: 400 });
      }
      deviceId = deviceId || String(sub.endpoint);
      log("web_preflight", { endpoint: shortId(sub.endpoint), hasP256: !!sub?.keys?.p256dh, hasAuth: !!sub?.keys?.auth });
    } else {
      fcm = String(body.fcm_token || "").trim();
      if (!fcm) {
        return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      }
      deviceId = deviceId || fcm;
      log("fcm_preflight", { token: shortId(fcm) });
    }

    /* 4) Ecritures selon le mode */
    if (ident.mode === "supabase") {
      // (A) Session Supabase : on écrit dans push_subscriptions (parent)
      const a = await upsertParentRow(srv, ident.userId, platform, deviceId, sub, fcm, null);
      if (!a.ok) return NextResponse.json({ error: a.error, stage: a.stage }, { status: 400 });
      return NextResponse.json({ ok: true, who: "supabase", platform, device_id: deviceId });
    }

    if (ident.mode === "parent") {
      // (B) Cookie psess : double écriture
      //    - parent : push_subscriptions (compat historique)
      //    - élève  : push_subscriptions_student (pour le ciblage par kid)
      const a = await upsertParentRow(srv, ident.userId, platform, deviceId, sub, fcm, ident.studentId);
      if (!a.ok) return NextResponse.json({ error: a.error, stage: a.stage }, { status: 400 });

      const b = await upsertStudentRows(srv, [ident.studentId], platform, deviceId, sub, fcm);
      if (!b.ok) return NextResponse.json({ error: "student_upsert_failed", stage: "insert_student" }, { status: 400 });

      return NextResponse.json({
        ok: true,
        who: "parent",
        platform,
        device_id: deviceId,
        student_id: ident.studentId,
        writes: { parent: a.mode, student: b.mode }
      });
    }

    // (C) Mode device-only : pas d'userId → on n’écrit *que* dans push_subscriptions_student pour *tous* les enfants
    if (ident.mode === "device") {
      const res = await upsertStudentRows(srv, ident.studentIds, platform, deviceId, sub, fcm);
      if (!res.ok) return NextResponse.json({ error: "student_upsert_failed", stage: "insert_students" }, { status: 400 });

      return NextResponse.json({
        ok: true,
        who: "device",
        platform,
        device_id: deviceId,
        students: ident.studentIds,
        writes: res.mode,
      });
    }

    // impossible d’arriver ici
    return NextResponse.json({ error: "unhandled_identity" }, { status: 500 });
  } catch (e: any) {
    log("unhandled_error", { error: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
