// src/app/api/push/dispatch/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────
   Auth util
   ───────────────────────────────────────── */
function okAuth(req: Request) {
  const secret =
    (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const fromVercelCron = req.headers.has("x-vercel-cron");
  return fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
}

/* ─────────────────────────────────────────
   WebPush (VAPID)
   ───────────────────────────────────────── */
function ensureWebPushConfigured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !prv) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
  }
  // Important: l’adresse mail est juste un contact
  webpush.setVapidDetails("mailto:no-reply@example.com", pub, prv);
}

/* ─────────────────────────────────────────
   FCM (legacy HTTP v1) – simple ici
   Set env: FCM_SERVER_KEY=AAAA... (clé serveur “Cloud Messaging”)
   ───────────────────────────────────────── */
const FCM_KEY = process.env.FCM_SERVER_KEY || "";

async function sendFCM(
  to: string,
  title: string,
  body: string,
  url: string,
  data: any
) {
  if (!FCM_KEY) throw new Error("missing FCM_SERVER_KEY");
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${FCM_KEY}`,
    },
    body: JSON.stringify({
      to,
      notification: { title, body, click_action: url },
      data: { url, ...data },
      priority: "high",
    }),
  });
  if (!res.ok) throw new Error(`FCM ${res.status} ${await res.text()}`);
}

/* ─────────────────────────────────────────
   Main
   ───────────────────────────────────────── */
const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim(); // chez toi: 'pending'

async function run(req: Request) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Log d’entrée
  console.info(
    "[push/dispatch] start",
    new Date().toISOString(),
    "method=" + req.method,
    "WAIT_STATUS=" + WAIT_STATUS
  );

  try {
    ensureWebPushConfigured();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }

  const srv = getSupabaseServiceClient();

  // 1) Pick items en attente
  const { data: rows, error: pickErr } = await srv
    .from("notifications_queue")
    .select(
      "id, parent_id, channels, payload, title, body, status, attempts, created_at"
    )
    .eq("status", WAIT_STATUS)
    .contains("channels", ["push"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (pickErr) {
    return NextResponse.json({ ok: false, error: pickErr.message }, { status: 400 });
  }

  console.info(
    "[push/dispatch] picked",
    rows?.length || 0,
    "WAIT_STATUS=",
    WAIT_STATUS
  );

  if (!rows?.length) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent_device_sends: 0,
      dropped: 0,
    });
  }

  // 2) Récupère tous les devices (web + mobile)
  const userIds = Array.from(
    new Set((rows as any[]).map((r) => String(r.parent_id)))
  );
  console.info("[push/dispatch] distinct_users", userIds.length);

  const { data: subs } = await srv
    .from("push_subscriptions")
    .select("user_id, platform, device_id, subscription_json, fcm_token")
    .in("user_id", userIds);

  console.info("[push/dispatch] subscriptions", (subs || []).length);

  type SubRow = {
    user_id: string;
    platform: string | null;
    device_id: string | null;
    subscription_json: any;
    fcm_token: string | null;
  };

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of (subs || []) as SubRow[]) {
    const k = String(s.user_id);
    // Si subscription_json était stocké en string, on tente un parse
    let subJson = s.subscription_json as any;
    if (subJson && typeof subJson === "string") {
      try {
        subJson = JSON.parse(subJson);
      } catch {
        /* ignore */
      }
    }
    subsByUser.set(k, [...(subsByUser.get(k) || []), { ...s, subscription_json: subJson }]);
  }

  let sentDeviceSends = 0;
  let dropped = 0;

  // 3) Envoi multi-devices
  for (const n of rows as any[]) {
    const list = subsByUser.get(String(n.parent_id)) || [];

    // Sécuriser/normaliser le payload
    let coreData: any = n?.payload;
    if (coreData && typeof coreData === "string") {
      try {
        coreData = JSON.parse(coreData);
      } catch {
        coreData = {};
      }
    }
    coreData = coreData || {};

    const typ =
      coreData?.type || coreData?.kind || coreData?.event || "notification";

    const title =
      coreData?.title ||
      n?.title ||
      (typ === "conduct_penalty" || typ === "penalty"
        ? "Sanction"
        : typ === "attendance" || typ === "absent" || typ === "late"
        ? "Absence / Retard"
        : "Notification");

    const body = coreData?.body || n?.body || "";
    const url = "/parents";

    console.info("[push/dispatch] trying", {
      notif_id: n.id,
      parent_id: n.parent_id,
      devices: list.map((s) => ({
        platform: s.platform,
        endpoint:
          (s as any)?.subscription_json?.endpoint?.slice(0, 80) || undefined,
        has_fcm: !!s.fcm_token,
      })),
    });

    const pushPayload = JSON.stringify({ title, body, url, data: coreData });

    let successes = 0;
    let lastError = "";

    if (list.length === 0) {
      lastError = "no_subscriptions";
    }

    for (const s of list) {
      const platform = (s.platform || "").toLowerCase();

      // WEB via WebPush
      if (s.subscription_json && platform === "web") {
        try {
          await webpush.sendNotification(s.subscription_json, pushPayload);
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || "");
          lastError = msg;
          console.warn("[push/dispatch] webpush error", msg);
          // tokens invalides → on nettoie
          if (/(410|404|not a valid|unsubscribe)/i.test(msg)) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", n.parent_id)
              .eq("platform", s.platform);
            if (s.device_id) q = q.eq("device_id", s.device_id);
            await q;
          }
        }
        continue;
      }

      // MOBILE via FCM
      if (s.fcm_token) {
        try {
          await sendFCM(s.fcm_token, title, body, url, coreData);
          successes++;
          sentDeviceSends++;
        } catch (err: any) {
          const msg = String(err?.message || "");
          lastError = msg;
          console.warn("[push/dispatch] fcm error", msg);
          if (/(NotRegistered|InvalidRegistration|410|404)/i.test(msg)) {
            dropped++;
            let q = srv
              .from("push_subscriptions")
              .delete()
              .eq("user_id", n.parent_id);
            if (s.device_id) q = q.eq("device_id", s.device_id);
            await q;
          }
        }
      }
    }

    // 4) Met à jour la file
    if (successes > 0) {
      await srv
        .from("notifications_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: (Number(n.attempts) || 0) + 1,
          last_error: null,
        })
        .eq("id", n.id);
    } else {
      await srv
        .from("notifications_queue")
        .update({
          status: WAIT_STATUS,
          attempts: (Number(n.attempts) || 0) + 1,
          last_error: (lastError || "").slice(0, 300),
        })
        .eq("id", n.id);
    }
  }

  return NextResponse.json({
    ok: true,
    attempted: rows.length,
    sent_device_sends: sentDeviceSends,
    dropped,
  });
}

export const GET = run;
export const POST = run;
