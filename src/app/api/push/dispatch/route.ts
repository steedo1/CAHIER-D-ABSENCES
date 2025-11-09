//src/app/api/push/dispatch/route.ts
import { NextResponse } from "next/server";
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
function okAuth(req: Request) {
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
  user_id: string;
  platform: string | null;
  device_id: string | null;
  subscription_json: any;
  fcm_token: string | null;
};

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

/* ──────────────── Main ──────────────── */
async function run(req: Request) {
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

  // 2) Subscriptions (web + mobile)
  const userIds = Array.from(new Set(rows.map((r) => String(r.parent_id))));
  console.info("[push/dispatch] subs_fetch", { id, userCount: userIds.length });

  const { data: subs, error: subsErr } = await srv
    .from("push_subscriptions")
    .select("user_id,platform,device_id,subscription_json,fcm_token")
    .in("user_id", userIds);

  if (subsErr) {
    console.error("[push/dispatch] subs_select_error", { id, error: subsErr.message });
  }

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of (subs || []) as SubRow[]) {
    let subJson = s.subscription_json as any;
    if (subJson && typeof subJson === "string") {
      try {
        subJson = JSON.parse(subJson);
      } catch {}
    }
    const k = String(s.user_id);
    const arr = subsByUser.get(k) || [];
    arr.push({ ...s, subscription_json: subJson });
    subsByUser.set(k, arr);
  }

  console.info("[push/dispatch] subs_indexed", {
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

  // 3) Envois
  let sentDeviceSends = 0,
    dropped = 0;

  for (const n of rows) {
    const list = subsByUser.get(String(n.parent_id)) || [];
    const core = safeParse<any>(n.payload) || {};
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
    const url = "/parents";

    console.info("[push/dispatch] item_begin", {
      id,
      qid: n.id,
      parent: shortId(n.parent_id),
      typ,
      title,
      bodyLen: (body || "").length,
      subs: list.length,
    });

    const payload = JSON.stringify({ title, body, url, data: core });

    let successes = 0;
    let lastError = list.length ? "" : "no_subscriptions";

    if (!list.length) {
      console.warn("[push/dispatch] no_subscriptions_for_parent", { id, qid: n.id, parent: shortId(n.parent_id) });
    }

    for (const s of list) {
      const platform = (s.platform || "").toLowerCase();
      const endpoint = s.subscription_json?.endpoint || s.device_id || s.fcm_token;
      const endpointShort = shortId(endpoint, 20);

      // WEB via WebPush
      if (s.subscription_json && platform === "web") {
        console.info("[push/dispatch] web_send_try", { id, qid: n.id, platform, endpoint: endpointShort });
        try {
          const res: any = await webpush.sendNotification(s.subscription_json, payload);
          // web-push may or may not expose details; we just log we got here
          console.info("[push/dispatch] web_send_ok", {
            id,
            qid: n.id,
            endpoint: endpointShort,
            statusCode: res?.statusCode ?? null,
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
          });
          if (/(410|404|not a valid|unsubscribe|expired|Gone)/i.test(msg)) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", n.parent_id)
              .eq("platform", s.platform);
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
        continue;
      }

      // MOBILE via FCM
      if (s.fcm_token) {
        console.info("[push/dispatch] fcm_try", { id, qid: n.id, token: shortId(s.fcm_token, 20) });
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
          });
          if (/(NotRegistered|InvalidRegistration|410|404)/i.test(msg)) {
            dropped++;
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
        continue;
      }

      console.debug("[push/dispatch] skip_sub_unknown_channel", {
        id,
        qid: n.id,
        platform,
        hasWebSub: !!s.subscription_json,
        hasFcm: !!s.fcm_token,
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

export const GET = run;
export const POST = run;