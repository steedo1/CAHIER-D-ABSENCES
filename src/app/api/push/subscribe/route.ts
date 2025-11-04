// src/app/api/push/subscribe/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "push_subscriptions";

const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
function log(stage: string, meta: Record<string, unknown>) {
  if (VERBOSE) console.info(`[push/subscribe] ${stage}`, meta);
}

// Réponse CORS de confort si nécessaire
export function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

type Body = {
  platform?: string;       // "web" | "android" | "ios"
  device_id?: string;      // id matériel; pour web on dérive de endpoint
  subscription?: any;      // Web Push subscription (endpoint + keys)
  fcm_token?: string;      // Mobile FCM token
  // champs libres ignorés côté DB
};

function hashId(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  try {
    // 0) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      log("auth_fail", {});
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", { user_id: user.id });

    // 1) Parse JSON
    let body: Body | null = null;
    try { body = await req.json(); }
    catch (e: any) {
      log("json_parse_error", { message: String(e?.message || e) });
      return NextResponse.json({ error: "invalid_json", stage: "parse" }, { status: 400 });
    }
    if (!body) return NextResponse.json({ error: "empty_body", stage: "parse" }, { status: 400 });

    // 2) Plateforme
    let platform = String(body.platform || "").toLowerCase().trim();
    if (!platform) {
      if (body.subscription?.endpoint) platform = "web";
      else if (body.fcm_token) platform = "android";
    }
    if (!["web", "android", "ios"].includes(platform)) {
      return NextResponse.json({
        error: "unknown_platform",
        stage: "preflight",
        hint: "platform doit être 'web', 'android' ou 'ios'",
      }, { status: 400 });
    }

    // 3) Valider charge selon plateforme
    const now = new Date().toISOString();
    let deviceId = String(body.device_id || "").trim();
    const row: any = {
      user_id: user.id,
      platform,
      last_seen_at: now,
    };

    if (platform === "web") {
      const sub = body.subscription;
      const endpointOk = !!sub?.endpoint;
      const keysOk = !!(sub?.keys?.p256dh && sub?.keys?.auth);
      log("preflight_web", {
        has_vapid_pub: !!process.env.VAPID_PUBLIC_KEY || !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        keys_present: { endpoint: endpointOk, p256dh: !!sub?.keys?.p256dh, auth: !!sub?.keys?.auth },
      });
      if (!endpointOk || !keysOk) {
        return NextResponse.json({
          error: "missing_or_invalid_subscription",
          stage: "preflight",
          hint: "Attendu: PushSubscription avec endpoint + keys.p256dh + keys.auth",
        }, { status: 400 });
      }
      // device_id compact & stable
      deviceId = deviceId || hashId(String(sub.endpoint));
      row.device_id = deviceId;
      row.subscription_json = sub;     // ← stockage Web Push
      // fcm_token NULL pour le web
    } else {
      // ANDROID / iOS
      const token = String(body.fcm_token || "").trim();
      if (!token) {
        return NextResponse.json({
          error: "missing_fcm_token",
          stage: "preflight",
          hint: "Envoyer { fcm_token: string } pour android/ios",
        }, { status: 400 });
      }
      row.fcm_token = token;           // ← stockage FCM
      row.device_id = deviceId || token; // idempotent si pas d'id matériel
      log("preflight_mobile", { platform, has_token: true, has_device_id: !!deviceId });
    }

    // 4) UPSERT (multi-devices OK)
    const onConflict = "user_id,platform,device_id";
    const up = await srv.from(TABLE).upsert(row, { onConflict });

    if (up.error) {
      log("upsert_error", { message: up.error.message });

      // fallback si la contrainte unique n'existe pas encore
      if (/no unique|exclusion constraint/i.test(up.error.message)) {
        log("fallback_update_then_insert", { onConflict });

        const upd = await srv
          .from(TABLE)
          .update(row)
          .match({ user_id: user.id, platform, device_id: row.device_id })
          .select("user_id");

        if (upd.error) {
          log("update_error", { message: upd.error.message });
          if (/column .* does not exist/i.test(upd.error.message)) {
            return NextResponse.json({
              error: upd.error.message, stage: "update",
              hint: "Vérifie que les colonnes (platform, device_id, subscription_json, fcm_token, last_seen_at) existent.",
            }, { status: 400 });
          }
        }
        if (upd.data && upd.data.length) {
          log("update_ok", { updated: upd.data.length });
          return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id });
        }

        const ins = await srv.from(TABLE).insert(row).select("user_id");
        if (ins.error) {
          log("insert_error", { message: ins.error.message });
          if (/duplicate key|unique constraint/i.test(ins.error.message)) {
            log("insert_duplicate_but_ok", {});
            return NextResponse.json({ ok: true, mode: "race-ok", platform, device_id: row.device_id });
          }
          return NextResponse.json({
            error: ins.error.message, stage: "insert",
            hint: "Vérifie la contrainte UNIQUE et les colonnes attendues.",
          }, { status: 400 });
        }
        log("insert_ok", {});
        return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id });
      }

      // autre erreur
      return NextResponse.json({
        error: up.error.message, stage: "upsert",
        hint: "Vérifie la contrainte UNIQUE (user_id,platform,device_id) et RLS (service role côté API).",
      }, { status: 400 });
    }

    log("upsert_ok", { platform, device_id: row.device_id });
    return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id });
  } catch (e: any) {
    log("unhandled", { message: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
