import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Logs ───────── */
const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
function shortId(x: unknown, n = 16) {
  const s = String(x ?? "");
  if (!s) return s;
  return s.length <= n ? s : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(-Math.max(4, Math.floor(n / 2)))}`;
}
function log(stage: string, meta: Record<string, unknown>) {
  if (VERBOSE) console.info(`[push/subscribe] ${stage}`, meta);
}

/* ───────── Types ───────── */
type Body = {
  platform?: string;   // "web" | "android" | "ios"
  device_id?: string;  // endpoint (web) ou device id (mobile)
  subscription?: any;  // webpush subscription JSON
  fcm_token?: string;  // FCM token
};

/* ───────── helpers ───────── */
function randPwd(n = 24) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map((b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(b % 62))
    .join("");
}

async function ensureAuthBackedParentId(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string,
  institutionId?: string | null
): Promise<string | null> {
  const dev = await srv
    .from("parent_devices")
    .select("device_id,parent_profile_id")
    .eq("device_id", deviceId)
    .maybeSingle();

  let parentId = dev.data?.parent_profile_id ?? null;

  if (parentId) {
    const prof = await srv.from("profiles").select("id").eq("id", parentId).maybeSingle();
    if (prof.data?.id) return parentId;
  }

  // créer user Auth
  const email = `parent+${deviceId}@parents.local`;
  const pass = randPwd();
  const created = await srv.auth.admin.createUser({
    email,
    password: pass,
    email_confirm: true,
    user_metadata: { origin: "parent_device", device_id: deviceId },
  });
  if (created.error || !created.data?.user?.id) {
    log("auth_admin_createUser_err", { err: created.error?.message });
    return null;
  }
  parentId = created.data.user.id;

  // aligner parent_devices
  if (!dev.data) {
    await srv.from("parent_devices").insert({ device_id: deviceId, parent_profile_id: parentId });
  } else {
    await srv.from("parent_devices").update({ parent_profile_id: parentId }).eq("device_id", deviceId);
  }

  // créer profile
  const payload: any = { id: parentId };
  if (institutionId) payload.institution_id = institutionId;
  const profIns = await srv.from("profiles").insert(payload);
  if (profIns.error && !/duplicate key|already exists/i.test(profIns.error.message)) {
    log("ensureProfile insert_err", { err: profIns.error.message, payload });
    return null;
  } else if (!profIns.error) {
    log("ensureProfile insert_ok", { parentId });
  }

  // rôle parent (si table/colonnes ok)
  if (institutionId) {
    const exists = await srv
      .from("user_roles")
      .select("profile_id")
      .eq("profile_id", parentId)
      .eq("institution_id", institutionId)
      .maybeSingle();
    if (!exists.data?.profile_id) {
      const ur = await srv
        .from("user_roles")
        .insert({ profile_id: parentId, institution_id: institutionId, role: "parent" as any });
      if (ur.error) log("user_roles_insert_err", { err: ur.error.message });
      else log("user_roles_insert_ok", { parentId, institutionId });
    }
  }

  return parentId;
}

/* ───────── Route ───────── */
export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const startedAt = new Date().toISOString();

  try {
    // Auth préférée : cookie parent_device
    const jar = await cookies(); // Next 15
    const parentDevice = jar.get("parent_device")?.value || "";

    // Institution (si connue via l’attache)
    let instId: string | null = null;
    if (parentDevice) {
      const r = await srv
        .from("parent_device_children")
        .select("institution_id")
        .eq("device_id", parentDevice)
        .order("added_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      instId = r.data?.institution_id ?? null;
      log("device_institution", { instId });
    }

    // Résoudre un vrai profile id exploitable par FK
    let userId: string | null = null;
    if (parentDevice) {
      userId = await ensureAuthBackedParentId(srv, parentDevice, instId);
    }
    const { data: { user } } = await supa.auth.getUser();
    if (!userId) userId = user?.id || null;

    if (!userId) {
      log("auth_fail", { startedAt, haveCookie: !!parentDevice });
      return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });
    }
    log("auth_ok", { startedAt, userId, haveCookie: !!parentDevice, haveSupabaseUser: !!user?.id });

    // Body
    let body: Body | null = null;
    try {
      body = await req.json();
    } catch (e: any) {
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
    log("platform_detect", { platformRaw, platform, hasSub: !!body.subscription, hasFcm: !!body.fcm_token });

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
      row.subscription_json = sub;
    } else {
      const token = String(body.fcm_token || "").trim();
      log("fcm_preflight", { token: shortId(token) });
      if (!token) {
        return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      }
      row.fcm_token = token;
      row.device_id = deviceId || token;
    }

    // Upsert (FK maintenant satisfait)
    const onConflict = "user_id,platform,device_id";
    log("upsert_try", { user_id: shortId(userId), platform, device_id: shortId(row.device_id) });

    const up = await srv.from("push_subscriptions").upsert(row, { onConflict, ignoreDuplicates: false });

    if (up.error) {
      log("upsert_error", {
        code: (up.error as any).code,
        message: up.error.message,
        details: (up.error as any).details,
        hint: (up.error as any).hint,
      });

      const upd = await srv
        .from("push_subscriptions")
        .update(row)
        .match({ user_id: userId, platform, device_id: row.device_id })
        .select("user_id");

      if (upd.error || !upd.data?.length) {
        if (upd.error) log("update_fail", { code: (upd.error as any).code, message: upd.error.message });
        else log("update_no_match", {});

        const ins = await srv.from("push_subscriptions").insert({ ...row, user_id: userId }).select("user_id");
        if (ins.error) {
          log("insert_fail", {
            code: (ins.error as any).code,
            message: ins.error.message,
            details: (ins.error as any).details,
            hint: (ins.error as any).hint,
          });
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
