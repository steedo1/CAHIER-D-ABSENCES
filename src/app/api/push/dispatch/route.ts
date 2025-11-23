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
async function sendFCM(
  to: string,
  title: string,
  body: string,
  url: string,
  data: any,
) {
  if (!FCM_KEY) throw new Error("missing FCM_SERVER_KEY");
  const payload = {
    to,
    notification: { title, body, click_action: url },
    data: { url, ...data },
    priority: "high",
  };
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `key=${FCM_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`FCM ${res.status} ${text}`);
}

/* ──────────────── Types ──────────────── */
type QueueRow = {
  id: string;
  institution_id: string | null; // 👈 ajouté pour cibler les admins par établissement
  parent_id: string | null;
  student_id: string | null;
  channels: any;
  payload: any;
  title: string | null;
  body: string | null;
  status: string;
  attempts: number | null;
  created_at: string;
  meta: any | null;
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
    if (!ok)
      console.debug("[push/dispatch] skip_no_push_channel", {
        id: row.id,
        channels: raw,
      });
    return ok;
  } catch (e: any) {
    console.warn("[push/dispatch] channels_parse_error", {
      id: row.id,
      error: String(e?.message || e),
    });
    return false;
  }
}

/* ──────────────── Main ──────────────── */
export const GET = run;
export const POST = run;

async function run(req: Request) {
  const id = rid();
  const t0 = Date.now();
  console.info("[push/dispatch] start", {
    id,
    when: new Date().toISOString(),
    method: req.method,
    waitStatus: WAIT_STATUS,
  });

  if (!okAuth(req)) {
    console.warn("[push/dispatch] forbidden", { id });
    return NextResponse.json({ ok: false, error: "forbidden", id }, { status: 403 });
  }

  try {
    ensureWebPushConfigured();
  } catch (e: any) {
    console.error("[push/dispatch] vapid_config_error", {
      id,
      error: String(e?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), id },
      { status: 500 },
    );
  }

  const srv = getSupabaseServiceClient();

  // 1) Récupérer les items en attente (+ on prend student_id + meta)
  console.info("[push/dispatch] pick_pending_query", { id });
  const { data: raw, error: pickErr } = await srv
    .from("notifications_queue")
    .select(
      "id,institution_id,parent_id,student_id,channels,payload,title,body,status,attempts,created_at,meta",
    )
    .eq("status", WAIT_STATUS)
    .order("created_at", { ascending: true })
    .limit(400);

  if (pickErr) {
    console.error("[push/dispatch] select_error", { id, error: pickErr.message });
    return NextResponse.json(
      { ok: false, error: pickErr.message, stage: "select", id },
      { status: 200 },
    );
  }

  const rows: QueueRow[] = (raw || []).filter(hasPushChannel);
  console.info("[push/dispatch] picked_effective", {
    id,
    total: rows.length,
    sample: rows.slice(0, 3).map((r) => {
      const p = safeParse<any>(r.payload) || {};
      return {
        id: r.id,
        parent: shortId(r.parent_id),
        student: shortId(r.student_id),
        metaDev: shortId((safeParse<any>(r.meta) || {}).device_id),
        typ: p?.type || p?.kind || p?.event || "notification",
        title: r.title || p?.title || null,
        created_at: r.created_at,
      };
    }),
  });

  if (!rows.length) {
    const ms = Date.now() - t0;
    console.info("[push/dispatch] done_empty", { id, ms });
    return NextResponse.json({
      ok: true,
      id,
      attempted: 0,
      sent_device_sends: 0,
      dropped: 0,
      ms,
    });
  }

  // 2) Résoudre les user_ids (parents) à partir de parent_id | meta.device_id | student_guardians
  const noParent = rows.filter((r) => !r.parent_id);
  const deviceIds = Array.from(
    new Set(
      noParent
        .map(
          (r) => (safeParse<any>(r.meta) || {}).device_id as string | undefined,
        )
        .filter(Boolean),
    ),
  );
  const studentIds = Array.from(
    new Set(noParent.map((r) => r.student_id).filter(Boolean)),
  ) as string[];

  const deviceToParent = new Map<string, string>(); // device_id -> parent_profile_id
  if (deviceIds.length) {
    const { data: mapDev, error: mapErr } = await srv
      .from("parent_devices")
      .select("device_id,parent_profile_id")
      .in("device_id", deviceIds);
    if (mapErr)
      console.warn("[push/dispatch] parent_devices_err", {
        id,
        error: mapErr.message,
      });
    for (const row of mapDev || []) {
      if (row.device_id && row.parent_profile_id) {
        deviceToParent.set(
          String(row.device_id),
          String(row.parent_profile_id),
        );
      }
    }
  }

  const studToParents = new Map<string, string[]>();
  if (studentIds.length) {
    const { data: sgs, error: sgErr } = await srv
      .from("student_guardians")
      .select("student_id,parent_id,notifications_enabled")
      .in("student_id", studentIds);
    if (sgErr)
      console.warn("[push/dispatch] student_guardians_err", {
        id,
        error: sgErr.message,
      });
    for (const row of sgs || []) {
      if (row.notifications_enabled === false) continue;
      const st = String((row as any).student_id);
      const pid = String((row as any).parent_id || "");
      if (!pid) continue;
      const arr = studToParents.get(st) || [];
      arr.push(pid);
      studToParents.set(st, Array.from(new Set(arr)));
    }
  }

  // Pour chaque queue row, liste de user_ids cibles (parents / responsables)
  const targetUserIdsByRow = new Map<string, string[]>();
  for (const r of rows) {
    let ids: string[] = [];
    if (r.parent_id) ids.push(String(r.parent_id));

    if (!ids.length) {
      const dev = (safeParse<any>(r.meta) || {}).device_id as
        | string
        | undefined;
      if (dev && deviceToParent.has(dev)) {
        ids.push(deviceToParent.get(dev)!);
      }
    }

    if (!ids.length && r.student_id && studToParents.has(r.student_id)) {
      ids.push(...(studToParents.get(r.student_id) || []));
    }

    ids = Array.from(new Set(ids.filter(Boolean)));
    targetUserIdsByRow.set(r.id, ids);
  }

  // 2.b) Ajouter les ADMIN / SUPER_ADMIN pour certains messages (ex: admin_attendance_monitor)
  const adminTargetRows = rows.filter((r) => {
    const p = safeParse<any>(r.payload) || {};
    const kind = p?.kind || p?.type || "";
    return kind === "admin_attendance_monitor";
  });

  const instIdsForAdminRows = Array.from(
    new Set(
      adminTargetRows
        .map((r) => r.institution_id)
        .filter(Boolean) as string[],
    ),
  );

  const adminByInstitution = new Map<string, string[]>();
  if (instIdsForAdminRows.length) {
    const { data: roleRows, error: roleErr2 } = await srv
      .from("user_roles")
      .select("profile_id,institution_id,role")
      .in("institution_id", instIdsForAdminRows)
      .in("role", ["admin", "super_admin"]);
    if (roleErr2) {
      console.warn("[push/dispatch] admin_roles_err", {
        id,
        error: roleErr2.message,
      });
    } else {
      for (const r of roleRows || []) {
        const inst = String((r as any).institution_id);
        const pid = String((r as any).profile_id || "");
        if (!inst || !pid) continue;
        const arr = adminByInstitution.get(inst) || [];
        arr.push(pid);
        adminByInstitution.set(inst, Array.from(new Set(arr)));
      }
    }
  }

  for (const r of adminTargetRows) {
    const inst = r.institution_id ? String(r.institution_id) : "";
    if (!inst) continue;
    const adminIds = adminByInstitution.get(inst) || [];
    if (!adminIds.length) continue;
    const cur = targetUserIdsByRow.get(r.id) || [];
    const merged = Array.from(new Set([...cur, ...adminIds]));
    targetUserIdsByRow.set(r.id, merged);
  }

  // Tous les user_ids à charger côté push_subscriptions
  const allUserIds = Array.from(
    new Set(Array.from(targetUserIdsByRow.values()).flatMap((a) => a)),
  );

  // 3) Subscriptions (web + mobile) pour ces user_ids
  console.info("[push/dispatch] subs_fetch", {
    id,
    userCount: allUserIds.length,
  });
  const { data: subs, error: subsErr } = allUserIds.length
    ? await srv
        .from("push_subscriptions")
        .select("user_id,platform,device_id,subscription_json,fcm_token")
        .in("user_id", allUserIds)
    : { data: [], error: null as any };

  if (subsErr)
    console.error("[push/dispatch] subs_select_error", {
      id,
      error: subsErr.message,
    });

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

  // 4) Envois
  let sentDeviceSends = 0,
    dropped = 0;

  for (const n of rows) {
    const core = safeParse<any>(n.payload) || {};
    const typ = core?.type || core?.kind || core?.event || "notification";
    const title =
      core?.title ||
      n?.title ||
      (typ === "conduct_penalty" || typ === "penalty"
        ? "Sanction"
        : typ === "attendance" ||
          typ === "absent" ||
          typ === "late"
        ? "Absence / Retard"
        : typ === "admin_attendance_monitor"
        ? "Surveillance des appels"
        : "Notification");
    const body = core?.body || n?.body || "";
    const url = "/parents";

    const targetUsers = targetUserIdsByRow.get(n.id) || [];
    const list: SubRow[] = targetUsers.flatMap(
      (uid) => subsByUser.get(uid) || [],
    );

    console.info("[push/dispatch] item_begin", {
      id,
      qid: n.id,
      targetUserCount: targetUsers.length,
      subs: list.length,
      parent_id: shortId(n.parent_id),
      student: shortId(n.student_id),
    });

    const payloadStr = JSON.stringify({ title, body, url, data: core });

    let successes = 0;
    let lastError = list.length ? "" : "no_subscriptions";

    if (!list.length) {
      console.warn("[push/dispatch] no_resolved_subscriptions", {
        id,
        qid: n.id,
        parent_id: n.parent_id,
        student_id: n.student_id,
        metaDev: shortId((safeParse<any>(n.meta) || {}).device_id),
      });
    }

    for (const s of list) {
      const platform = (s.platform || "").toLowerCase();
      const endpoint =
        s.subscription_json?.endpoint || s.device_id || s.fcm_token;
      const endpointShort = shortId(endpoint, 20);

      // WEB via WebPush
      if (s.subscription_json && platform === "web") {
        try {
          const res: any = await webpush.sendNotification(
            s.subscription_json,
            payloadStr,
          );
          console.info("[push/dispatch] web_send_ok", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
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
            user: shortId(s.user_id),
            endpoint: endpointShort,
            error: msg.slice(0, 500),
          });
          if (
            /(410|404|not a valid|unsubscribe|expired|Gone)/i.test(msg)
          ) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", s.user_id)
              .eq("platform", s.platform || "");
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
              console.info("[push/dispatch] sub_deleted", {
                id,
                qid: n.id,
                endpoint: endpointShort,
              });
            }
          }
        }
        continue;
      }

      // MOBILE via FCM
      if (s.fcm_token) {
        try {
          await sendFCM(s.fcm_token, title, body, url, core);
          console.info("[push/dispatch] fcm_send_ok", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            token: shortId(s.fcm_token, 20),
          });
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || err);
          lastError = msg;
          console.warn("[push/dispatch] fcm_fail", {
            id,
            qid: n.id,
            user: shortId(s.user_id),
            error: msg.slice(0, 500),
          });
          if (/(NotRegistered|InvalidRegistration|410|404)/i.test(msg)) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", s.user_id);
            if (s.device_id) q = q.eq("device_id", s.device_id);
            const { error: delErr } = await q;
            if (delErr) {
              console.warn("[push/dispatch] sub_delete_fail", {
                id,
                qid: n.id,
                error: delErr.message,
              });
            } else {
              console.info("[push/dispatch] sub_deleted", {
                id,
                qid: n.id,
                token: shortId(s.fcm_token, 20),
              });
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
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts,
          last_error: null,
        })
        .eq("id", n.id);
      if (updErr) {
        console.error("[push/dispatch] queue_update_sent_fail", {
          id,
          qid: n.id,
          error: updErr.message,
        });
      } else {
        console.info("[push/dispatch] queue_update_sent_ok", {
          id,
          qid: n.id,
          attempts,
          successes,
        });
      }
    } else {
      const { error: updErr } = await srv
        .from("notifications_queue")
        .update({
          status: WAIT_STATUS,
          attempts,
          last_error: (lastError || "").slice(0, 300),
        })
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
  console.info("[push/dispatch] done", {
    id,
    attempted: rows.length,
    sent_device_sends: sentDeviceSends,
    dropped,
    ms,
  });
  return NextResponse.json({
    ok: true,
    id,
    attempted: rows.length,
    sent_device_sends: sentDeviceSends,
    dropped,
    ms,
  });
}
