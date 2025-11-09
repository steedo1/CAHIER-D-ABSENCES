// src/app/api/push/dispatch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Config & Logs ───────────────────────── */
const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();
const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();
// VAPID: on accepte aussi NEXT_PUBLIC_VAPID_PUBLIC_KEY comme clé publique
const VAPID_PUBLIC =
  (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || "").trim();

function shortId(x: unknown, n = 16) {
  const s = String(x ?? "");
  if (!s) return s;
  return s.length <= n ? s : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(-Math.max(4, Math.floor(n / 2)))}`;
}
function log(stage: string, meta: Record<string, unknown>) {
  if (VERBOSE) console.info(`[push/dispatch] ${stage}`, meta);
}

/* ───────────────────────── Types ───────────────────────── */
type QueueRow = {
  id: string;
  student_id: string | null;
  parent_id: string | null;
  channels: any | null;        // jsonb
  channel: string | null;      // éventuel champ single-channel
  payload: any | null;         // jsonb (titre, body…)
  status: string;
  attempts: number | null;
  created_at: string;
  // colonnes présentes dans ta table (observées dans tes exports)
  title?: string | null;
  body?: string | null;
  severity?: string | null;
};

type WebSub = {
  platform: "web";
  device_id: string;
  subscription_json: any;
  last_seen_at: string | null;
};

type ParentSub = {
  platform: "web" | "android" | "ios";
  device_id: string;
  subscription_json: any;
  fcm_token: string | null;
  last_seen_at: string | null;
};

/* ───────────────────────── Helpers ───────────────────────── */

function ensureVapidReady() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    const reason = `missing VAPID keys (pub=${!!VAPID_PUBLIC}, prv=${!!VAPID_PRIVATE})`;
    log("vapid_missing", { reason });
    throw new Error(reason);
  }
  webpush.setVapidDetails("mailto:support@mca.local", VAPID_PUBLIC, VAPID_PRIVATE);
  log("vapid_env", {
    pubLen: VAPID_PUBLIC.length,
    prvLen: VAPID_PRIVATE.length,
    pubPreview: `${VAPID_PUBLIC.slice(0, 4)}…${VAPID_PUBLIC.slice(-4)}`,
  });
}

function isAuthorized(req: NextRequest) {
  const fromVercelCron = !!(req.headers.get("x-vercel-cron") || req.headers.get("x-cron"));
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secretPresent = !!CRON_SECRET;
  const bearerPresent = !!bearer;
  const allowed = fromVercelCron || (secretPresent && bearerPresent && bearer === CRON_SECRET);
  log("auth", { fromVercelCron, xCronPresent: !!req.headers.get("x-cron"), bearerPresent, secretPresent, allowed });
  return allowed;
}

function buildWebPayload(q: QueueRow) {
  const p = (q.payload && typeof q.payload === "object") ? q.payload : {};
  const title = (p.title as string) || q.title || "Notification";
  const body  = (p.body  as string) || q.body  || "";
  // data permet au SW de router
  return JSON.stringify({
    title,
    body,
    tag: (p.kind as string) || "generic",
    data: {
      qid: q.id,
      studentId: q.student_id,
      createdAt: q.created_at,
      kind: (p.kind as string) || "generic",
      severity: (p.severity as string) || q.severity || "info",
    },
  });
}

/* Renvoie les subs cibles:
   - student (device-only): push_subscriptions_student
   - parent  (historique) : push_subscriptions  (uniquement si parent_id non null) */
async function fetchTargets(srv: ReturnType<typeof getSupabaseServiceClient>, q: QueueRow) {
  const targets: WebSub[] = [];

  // Souscriptions "student"
  if (q.student_id) {
    const s1 = await srv
      .from("push_subscriptions_student")
      .select("platform, device_id, subscription_json, last_seen_at")
      .eq("student_id", q.student_id);

    if (s1.error) {
      log("subs_students_fail", { id: shortId(q.id), error: s1.error.message });
    } else {
      const web = (s1.data || []).filter((r: any) => r.platform === "web" && r.subscription_json?.endpoint);
      if (web.length) {
        log("subs_fetch_students", { id: shortId(q.id), studentCount: web.length });
        for (const r of web) {
          targets.push({
            platform: "web",
            device_id: r.device_id,
            subscription_json: r.subscription_json,
            last_seen_at: r.last_seen_at ?? null,
          });
        }
      }
    }
  }

  // Souscriptions "parent" (legacy) uniquement si parent défini
  if (q.parent_id) {
    const s2 = await srv
      .from("push_subscriptions")
      .select("platform, device_id, subscription_json, fcm_token, last_seen_at")
      .eq("user_id", q.parent_id);

    if (s2.error) {
      log("subs_parents_fail", { id: shortId(q.id), error: s2.error.message });
    } else {
      const web = (s2.data || []).filter((r: any) => r.platform === "web" && r.subscription_json?.endpoint);
      if (web.length) {
        log("subs_fetch_parents", { id: shortId(q.id), userCount: web.length });
        for (const r of web as ParentSub[]) {
          targets.push({
            platform: "web",
            device_id: r.device_id,
            subscription_json: r.subscription_json,
            last_seen_at: r.last_seen_at ?? null,
          });
        }
      } else {
        log("subs_fetch_parents", { id: shortId(q.id), userCount: 0 });
      }
    }
  }

  // dédoublonnage par endpoint (ou device_id)
  const seen = new Set<string>();
  const uniq: WebSub[] = [];
  for (const t of targets) {
    const endpoint = String(t.subscription_json?.endpoint || "");
    const key = endpoint || `dev:${t.device_id}`;
    if (key && !seen.has(key)) {
      seen.add(key);
      uniq.push(t);
    }
  }
  return uniq;
}

async function markSent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  qid: string
) {
  await srv.from("notifications_queue")
    .update({ status: "sent", sent_at: new Date().toISOString(), attempts: null, last_error: null })
    .eq("id", qid);
}

async function markRetry(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  qid: string,
  attempts: number,
  lastError: string
) {
  await srv.from("notifications_queue")
    .update({ status: WAIT_STATUS, attempts: (attempts || 0) + 1, last_error: lastError })
    .eq("id", qid);
}

/* ───────────────────────── Core sending ───────────────────────── */

async function sendWebPushToTargets(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  q: QueueRow,
  targets: WebSub[]
) {
  if (!targets.length) {
    log("no_targets", { id: shortId(q.id) });
    await markRetry(srv, q.id, q.attempts || 0, "no_subscriptions");
    return { sent: 0, total: 0 };
  }

  const payload = buildWebPayload(q);
  let sent = 0;
  const errors: string[] = [];

  for (const t of targets) {
    const sub = t.subscription_json;
    try {
      log("web_send_try", {
        qid: shortId(q.id),
        platform: "web",
        endpoint: shortId(sub?.endpoint),
        src: q.parent_id ? "parent" : "student",
      });

      const res = await webpush.sendNotification(sub, payload, { TTL: 3600 });
      const sc = (res as any)?.statusCode ?? 0;
      log("web_send_ok", { qid: shortId(q.id), status: sc });
      sent++;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.code ?? 0;
      const body = (typeof err?.body === "string" ? err.body : JSON.stringify(err?.body || "")).slice(0, 500);

      log("web_send_fail", {
        qid: shortId(q.id),
        endpoint: shortId(sub?.endpoint),
        status,
        body,
        src: q.parent_id ? "parent" : "student",
      });

      // Souscription expirée → purge
      if (status === 404 || status === 410) {
        await srv.from("push_subscriptions_student")
          .delete()
          .match({ student_id: q.student_id, platform: "web", device_id: t.device_id });

        // et on tente aussi côté legacy parent si jamais ça venait de là
        if (q.parent_id) {
          await srv.from("push_subscriptions")
            .delete()
            .match({ user_id: q.parent_id, platform: "web", device_id: t.device_id });
        }
      }

      // Erreur VAPID → on laisse pending mais trace explicite
      if (status === 401 || status === 403) {
        errors.push(`webpush_${status}_vapid`);
      } else {
        errors.push(`webpush_${status || "err"}`);
      }
    }
  }

  if (sent > 0) {
    await markSent(srv, q.id);
  } else {
    const msg = errors[0] || "send_failed";
    await markRetry(srv, q.id, q.attempts || 0, msg);
  }

  return { sent, total: targets.length };
}

/* ───────────────────────── Picking ───────────────────────── */

async function pickBatch(srv: ReturnType<typeof getSupabaseServiceClient>, limit = 50): Promise<QueueRow[]> {
  // 1) On liste quelques IDs "pending" en FIFO
  const cand = await srv
    .from("notifications_queue")
    .select("id")
    .eq("status", WAIT_STATUS)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (cand.error) {
    log("pick_pending_error", { error: cand.error.message });
    return [];
  }
  const ids = (cand.data || []).map((r: any) => r.id);
  if (!ids.length) return [];

  // 2) On prend la main par UPDATE status='processing' … RETURNING *
  const upd = await srv
    .from("notifications_queue")
    .update({ status: "processing" })
    .in("id", ids)
    .eq("status", WAIT_STATUS)
    .select("id, student_id, parent_id, channels, channel, payload, status, attempts, created_at, title, body, severity");

  if (upd.error) {
    log("pick_update_error", { error: upd.error.message });
    return [];
  }

  const picked: QueueRow[] = upd.data as any;
  log("picked_effective", {
    total: picked.length,
    sample: picked.slice(0, 3).map(p => ({
      id: shortId(p.id),
      parent: p.parent_id ? "yes" : "",
      typ: (p.payload && p.payload.kind) || "n/a",
      title: (p.payload && p.payload.title) || p.title || null,
      created_at: p.created_at,
    })),
  });

  return picked;
}

/* ───────────────────────── HTTP handler ───────────────────────── */

export async function POST(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const id = Math.random().toString(36).slice(2, 8);
  log("start", { id, when: new Date().toISOString(), method: "POST", waitStatus: WAIT_STATUS });

  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // VAPID ready + log
    ensureVapidReady();

    const batch = await pickBatch(srv, 50);
    if (!batch.length) {
      return NextResponse.json({ ok: true, picked: 0 });
    }

    let attempted = 0;
    let sentDeviceSends = 0;

    for (const q of batch) {
      attempted++;
      const targets = await fetchTargets(srv, q);

      log("item_begin", {
        id,
        qid: q.id,
        parent: q.parent_id ? "yes" : "",
        kid: shortId(q.student_id),
        typ: (q.payload && q.payload.kind) || "generic",
        title: (q.payload && q.payload.title) || q.title || null,
        bodyLen: String(((q.payload && q.payload.body) || q.body || "")).length,
        subs_parents: targets.filter(() => !!q.parent_id).length, // indicatif
        subs_students: targets.filter(() => !q.parent_id).length, // indicatif
        subs_total: targets.length,
      });

      // Pour l’instant on n’envoie que Web Push (FCM natif: à intégrer plus tard)
      const webTargets = targets.filter(t => t.platform === "web");
      const res = await sendWebPushToTargets(srv, q, webTargets);
      sentDeviceSends += res.sent;
    }

    log("done", { id, attempted, sentDeviceSends, dropped: 0 });
    return NextResponse.json({ ok: true, attempted, sentDeviceSends });
  } catch (e: any) {
    log("fatal", { id, error: String(e?.message || e) });
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
