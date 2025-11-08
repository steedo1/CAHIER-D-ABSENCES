// src/app/api/push/dispatch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers log ───────────────── */
function rid() {
  return Math.random().toString(36).slice(2, 8);
}
function shortId(x: string | null | undefined, n = 8) {
  const s = String(x || "");
  if (s.length <= n) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
function safeParse<T = any>(x: any): T | null {
  if (!x) return null;
  if (typeof x === "object") return x as T;
  try {
    return JSON.parse(String(x)) as T;
  } catch {
    return null;
  }
}
const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

/* ───────────────── Auth ───────────────── */
function okAuth(req: NextRequest) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");

  const allowed = fromVercelCron || (!!secret && (xCron === secret || bearer === secret));

  console.info("[push/dispatch] auth", {
    fromVercelCron,
    xCronPresent: !!xCron,
    bearerPresent: !!bearer,
    secretPresent: !!secret,
    allowed,
  });

  return allowed;
}

/* ──────────────── WebPush (VAPID) ──────────────── */
function ensureWebPushConfigured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  console.info("[push/dispatch] vapid_env", {
    pubLen: pub?.length || 0,
    prvLen: prv?.length || 0,
    pubPreview: pub ? shortId(pub, 12) : null,
  });
  if (!pub || !prv) throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
  webpush.setVapidDetails("mailto:no-reply@example.com", pub, prv);
}

/* ──────────────── FCM mobile (optionnel) ──────────────── */
const FCM_KEY = process.env.FCM_SERVER_KEY || "";
async function sendFCM(to: string, title: string, body: string, url: string, data: any) {
  if (!FCM_KEY) throw new Error("missing FCM_SERVER_KEY");
  const payload = {
    to,
    notification: { title, body, click_action: url },
    data: { url, ...data },
    priority: "high",
  };
  console.info("[push/dispatch] fcm_send_try", {
    to: shortId(to, 16),
    title,
    bodyLen: (body || "").length,
  });
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `key=${FCM_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    console.warn("[push/dispatch] fcm_send_fail", { status: res.status, text: text.slice(0, 400) });
    throw new Error(`FCM ${res.status} ${text}`);
  }
  console.info("[push/dispatch] fcm_send_ok", { status: res.status, body: text.slice(0, 200) });
}

/* ──────────────── Types & helpers ──────────────── */
type QueueRow = {
  id: string;
  parent_id: string;
  channels: any;
  payload: any;
  title: string | null;
  body: string | null;
  status: string;
  attempts: number | null;
  created_at: string;
};
type SubRow = {
  user_id?: string;          // parent route
  student_id?: string;       // élève (matricule)
  platform: string | null;
  device_id: string | null;
  subscription_json: any;
  fcm_token: string | null;
  __source?: "parent" | "student"; // pour la suppression au cleanup
};

/** Essaie de récupérer un student_id depuis la payload */
function extractStudentId(core: any): string | null {
  if (!core) return null;
  // chemins possibles
  if (typeof core.student_id === "string") return core.student_id;
  if (core.student?.id) return String(core.student.id);
  if (core.mark?.student_id) return String(core.mark.student_id);
  if (core.attendance?.student_id) return String(core.attendance.student_id);
  if (core.payload?.student_id) return String(core.payload.student_id);
  return null;
}

/* ──────────────── Main ──────────────── */
async function run(req: NextRequest) {
  const id = rid();
  const t0 = Date.now();
  console.info("[push/dispatch] start", { id, when: new Date().toISOString(), method: req.method, waitStatus: WAIT_STATUS });

  if (!okAuth(req)) {
    console.warn("[push/dispatch] forbidden", { id });
    return NextResponse.json({ ok: false, error: "forbidden", id }, { status: 403 });
  }

  try {
    ensureWebPushConfigured();
  } catch (e: any) {
    console.error("[push/dispatch] vapid_config_error", { id, error: String(e?.message || e) });
    return NextResponse.json({ ok: false, error: String(e?.message || e), id }, { status: 500 });
  }

  const srv = getSupabaseServiceClient();

  // 1) Récupérer les items en attente (on filtre plutôt en mémoire sur channels)
  console.info("[push/dispatch] pick_pending_query", { id });
  const { data: raw, error: pickErr } = await srv
    .from("notifications_queue")
    .select("id,parent_id,channels,payload,title,body,status,attempts,created_at")
    .eq("status", WAIT_STATUS)
    .order("created_at", { ascending: true })
    .limit(400);

  if (pickErr) {
    console.error("[push/dispatch] select_error", { id, error: pickErr.message });
    return NextResponse.json({ ok: false, error: pickErr.message, stage: "select", id }, { status: 200 });
  }

  console.info("[push/dispatch] picked_raw", { id, total: raw?.length || 0 });

  const rows: QueueRow[] = (raw || []).filter(hasPushChannel);
  console.info("[push/dispatch] picked_effective", {
    id,
    total: rows.length,
    sample: rows.slice(0, 3).map((r) => {
      const p = safeParse<any>(r.payload) || {};
      return {
        id: r.id,
        parent: shortId(r.parent_id),
        typ: p?.type || p?.kind || p?.event || "notification",
        title: r.title || p?.title || null,
        created_at: r.created_at,
      };
    }),
  });

  if (!rows.length) {
    const ms = Date.now() - t0;
    console.info("[push/dispatch] done_empty", { id, ms });
    return NextResponse.json({ ok: true, id, attempted: 0, sent_device_sends: 0, dropped: 0, ms });
  }

  // 2) Subscriptions (web + mobile) — parents
  const userIds = Array.from(new Set(rows.map((r) => String(r.parent_id))));
  console.info("[push/dispatch] subs_fetch_parents", { id, userCount: userIds.length });

  const { data: subs, error: subsErr } = await srv
    .from("push_subscriptions")
    .select("user_id,platform,device_id,subscription_json,fcm_token")
    .in("user_id", userIds);

  if (subsErr) {
    console.error("[push/dispatch] subs_select_error", { id, error: subsErr.message });
  }

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of (subs || []) as any[]) {
    let subJson = s.subscription_json;
    if (subJson && typeof subJson === "string") {
      try {
        subJson = JSON.parse(subJson);
      } catch {}
    }
    const k = String(s.user_id);
    const arr = subsByUser.get(k) || [];
    arr.push({ user_id: k, platform: s.platform, device_id: s.device_id, subscription_json: subJson, fcm_token: s.fcm_token, __source: "parent" });
    subsByUser.set(k, arr);
  }

  console.info("[push/dispatch] subs_indexed_parents", {
    id,
    totalSubs: subs?.length || 0,
    sample: Array.from(subsByUser.entries())
      .slice(0, 3)
      .map(([uid, arr]) => ({
        user: shortId(uid),
        count: arr.length,
        platforms: Array.from(new Set(arr.map((x) => (x.platform || "").toLowerCase()))),
      })),
  });

  // 2bis) Subscriptions — élèves (matricule)
  const studentIds = Array.from(
    new Set(
      rows
        .map((r) => extractStudentId(safeParse<any>(r.payload) || {}))
        .filter(Boolean) as string[],
    ),
  );
  console.info("[push/dispatch] subs_fetch_students", { id, studentCount: studentIds.length });

  let subsStudentByKid = new Map<string, SubRow[]>();
  if (studentIds.length) {
    try {
      const { data: subsKid, error: subsKidErr } = await srv
        .from("push_subscriptions_student")
        .select("student_id,platform,device_id,subscription_json,fcm_token")
        .in("student_id", studentIds);

      if (subsKidErr) {
        console.warn("[push/dispatch] subs_student_select_error", { id, error: subsKidErr.message });
      } else {
        for (const s of (subsKid || []) as any[]) {
          let subJson = s.subscription_json;
          if (subJson && typeof subJson === "string") {
            try {
              subJson = JSON.parse(subJson);
            } catch {}
          }
          const k = String(s.student_id);
          const arr = subsStudentByKid.get(k) || [];
          arr.push({
            student_id: k,
            platform: s.platform,
            device_id: s.device_id,
            subscription_json: subJson,
            fcm_token: s.fcm_token,
            __source: "student",
          });
          subsStudentByKid.set(k, arr);
        }
      }
    } catch (e: any) {
      console.warn("[push/dispatch] subs_student_unavailable", { id, error: String(e?.message || e) });
    }
  }

  // 3) Envois
  let sentDeviceSends = 0,
    dropped = 0;

  for (const n of rows) {
    const core = safeParse<any>(n.payload) || {};
    const kid = extractStudentId(core);

    const listParent = subsByUser.get(String(n.parent_id)) || [];
    const listKid = kid ? subsStudentByKid.get(String(kid)) || [] : [];
    const list = [...listParent, ...listKid];

    const typ = core?.type || core?.kind || core?.event || "notification";
    const title =
      core?.title ||
      n?.title ||
      (typ === "conduct_penalty" || typ === "penalty"
        ? "Sanction"
        : typ === "attendance" || typ === "absent" || typ === "late"
        ? "Absence / Retard"
        : "Notification");
    const body = core?.body || n?.body || "";
    const url = "/parents"; // page front existante

    console.info("[push/dispatch] item_begin", {
      id,
      qid: n.id,
      parent: shortId(n.parent_id),
      kid: kid ? shortId(kid) : null,
      typ,
      title,
      bodyLen: (body || "").length,
      subs_parents: listParent.length,
      subs_students: listKid.length,
      subs_total: list.length,
    });

    const payload = JSON.stringify({ title, body, url, data: core });

    let successes = 0;
    let lastError = list.length ? "" : "no_subscriptions";

    if (!list.length) {
      console.warn("[push/dispatch] no_subscriptions_for_item", {
        id,
        qid: n.id,
        parent: shortId(n.parent_id),
        kid: kid ? shortId(kid) : null,
      });
    }

    for (const s of list) {
      const platform = (s.platform || "").toLowerCase();
      const endpoint = s.subscription_json?.endpoint || s.device_id || s.fcm_token;
      const endpointShort = shortId(endpoint, 20);

      // WEB via WebPush
      if (s.subscription_json && platform === "web") {
        console.info("[push/dispatch] web_send_try", { id, qid: n.id, platform, endpoint: endpointShort, src: s.__source });
        try {
          const res: any = await webpush.sendNotification(s.subscription_json, payload);
          console.info("[push/dispatch] web_send_ok", {
            id,
            qid: n.id,
            endpoint: endpointShort,
            statusCode: res?.statusCode ?? null,
            src: s.__source,
          });
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || err);
          lastError = msg;
          console.warn("[push/dispatch] web_send_fail", {
            id,
            qid: n.id,
            endpoint: endpointShort,
            error: msg.slice(0, 500),
            src: s.__source,
          });
          if (/(410|404|not a valid|unsubscribe|expired|Gone)/i.test(msg)) {
            dropped++;
            // cleanup selon la source
            if (s.__source === "student") {
              let q = srv.from("push_subscriptions_student").delete();
              if (s.student_id) q = q.eq("student_id", s.student_id);
              if (s.platform) q = q.eq("platform", s.platform);
              if (s.device_id) q = q.eq("device_id", s.device_id);
              const { error: delErr } = await q;
              if (delErr) {
                console.warn("[push/dispatch] sub_student_delete_fail", {
                  id,
                  qid: n.id,
                  endpoint: endpointShort,
                  error: delErr.message,
                });
              } else {
                console.info("[push/dispatch] sub_student_deleted", { id, qid: n.id, endpoint: endpointShort });
              }
            } else {
              let q = srv.from("push_subscriptions").delete().eq("user_id", n.parent_id);
              if (s.platform) q = q.eq("platform", s.platform);
              if (s.device_id) q = q.eq("device_id", s.device_id);
              const { error: delErr } = await q;
              if (delErr) {
                console.warn("[push/dispatch] sub_delete_fail", {
                  id,
                  qid: n.id,
                  endpoint: endpointShort,
                  error: delErr.message,
                });
              } else {
                console.info("[push/dispatch] sub_deleted", { id, qid: n.id, endpoint: endpointShort });
              }
            }
          }
        }
        continue;
      }

      // MOBILE via FCM
      if (s.fcm_token) {
        console.info("[push/dispatch] fcm_try", { id, qid: n.id, token: shortId(s.fcm_token, 20), src: s.__source });
        try {
          await sendFCM(s.fcm_token, title, body, url, core);
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || err);
          lastError = msg;
          console.warn("[push/dispatch] fcm_fail", {
            id,
            qid: n.id,
            token: shortId(s.fcm_token, 20),
            error: msg.slice(0, 500),
            src: s.__source,
          });
          if (/(NotRegistered|InvalidRegistration|410|404)/i.test(msg)) {
            dropped++;
            if (s.__source === "student") {
              let q = srv.from("push_subscriptions_student").delete();
              if (s.student_id) q = q.eq("student_id", s.student_id);
              if (s.device_id) q = q.eq("device_id", s.device_id);
              const { error: delErr } = await q;
              if (delErr) {
                console.warn("[push/dispatch] sub_student_delete_fail", { id, qid: n.id, error: delErr.message });
              } else {
                console.info("[push/dispatch] sub_student_deleted", { id, qid: n.id, token: shortId(s.fcm_token, 20) });
              }
            } else {
              let q = srv.from("push_subscriptions").delete().eq("user_id", n.parent_id);
              if (s.device_id) q = q.eq("device_id", s.device_id);
              const { error: delErr } = await q;
              if (delErr) {
                console.warn("[push/dispatch] sub_delete_fail", { id, qid: n.id, error: delErr.message });
              } else {
                console.info("[push/dispatch] sub_deleted", { id, qid: n.id, token: shortId(s.fcm_token, 20) });
              }
            }
          }
        }
        continue;
      }

      console.debug("[push/dispatch] skip_sub_unknown_channel", {
        id,
        qid: n.id,
        platform,
        hasWebSub: !!s.subscription_json,
        hasFcm: !!s.fcm_token,
        src: s.__source,
      });
    }

    const attempts = (Number(n.attempts) || 0) + 1;

    if (successes > 0) {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null })
        .eq("id", n.id);
      if (updErr) {
        console.error("[push/dispatch] queue_update_sent_fail", { id, qid: n.id, error: updErr.message });
      } else {
        console.info("[push/dispatch] queue_update_sent_ok", { id, qid: n.id, attempts, successes });
      }
    } else {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({ status: WAIT_STATUS, attempts, last_error: (lastError || "").slice(0, 300) })
        .eq("id", n.id);
      if (updErr) {
        console.error("[push/dispatch] queue_update_retry_fail", {
          id,
          qid: n.id,
          attempts,
          error: updErr.message,
        });
      } else {
        console.warn("[push/dispatch] queue_update_retry_ok", {
          id,
          qid: n.id,
          attempts,
          lastError: (lastError || "").slice(0, 200),
        });
      }
    }
  }

  const ms = Date.now() - t0;
  console.info("[push/dispatch] done", { id, attempted: rows.length, sentDeviceSends, dropped, ms });

  return NextResponse.json({ ok: true, id, attempted: rows.length, sent_device_sends: sentDeviceSends, dropped, ms });
}

function hasPushChannel(row: QueueRow) {
  try {
    const raw = row.channels;
    const arr = Array.isArray(raw) ? raw : raw ? JSON.parse(String(raw)) : [];
    const ok = Array.isArray(arr) && arr.includes("push");
    if (!ok) {
      console.debug("[push/dispatch] skip_no_push_channel", {
        id: row.id,
        channels: raw,
      });
    }
    return ok;
  } catch (e: any) {
    console.warn("[push/dispatch] channels_parse_error", { id: row.id, error: String(e?.message || e) });
    return false;
  }
}

export const GET = run;
export const POST = run;
