// src/app/api/push/dispatch/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

/** Auth simple pour le cron : header X-CRON-SECRET doit matcher CRON_PUSH_SECRET */
function checkCronAuth(req: Request) {
  const hdr = (req.headers.get("x-cron-secret") || "").trim();
  const sec = (process.env.CRON_PUSH_SECRET || "").trim();
  return !!sec && hdr === sec;
}
function configureWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY!;
  const prv = process.env.VAPID_PRIVATE_KEY!;
  webpush.setVapidDetails(`mailto:no-reply@example.com`, pub, prv);
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  configureWebPush();
  const srv = getSupabaseServiceClient();

  // 1) Prend un lot de notifs en attente pour canal 'push'
  const { data: rows, error: pickErr } = await srv
    .from("notifications_queue")
    .select("id, parent_id, channels, payload, status, attempts")
    .eq("status", "pending")
    .contains("channels", ["push"]) // jsonb array qui contient 'push'
    .order("created_at", { ascending: true })
    .limit(200);

  if (pickErr) {
    return NextResponse.json({ error: pickErr.message }, { status: 400 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // 2) Souscriptions actives
  const userIds = Array.from(new Set(rows.map((r: any) => String(r.parent_id))));
  const { data: subs } = await srv
    .from("push_subscriptions")
    .select("user_id, subscription_json")
    .in("user_id", userIds);

  const byUser = new Map<string, any>((subs || []).map((s: any) => [String(s.user_id), s.subscription_json]));

  let sent = 0, dropped = 0;

  for (const n of rows as any[]) {
    const sub = byUser.get(String(n.parent_id));
    if (!sub) continue;

    const title = n.payload?.title || (n.payload?.event === "absent" ? "Absence" : "Notification");
    const body  = n.payload?.body  || "";
    const url   = "/parents";

    const pushPayload = JSON.stringify({
      title,
      body,
      url,
      data: n.payload || {},
    });

    try {
      await webpush.sendNotification(sub, pushPayload);

      sent++;
      await srv.from("notifications_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: (Number(n.attempts) || 0) + 1,
          last_error: null,
        })
      .eq("id", n.id);
    } catch (err: any) {
      const msg = String(err?.message || "");
      // nettoyage abonnement invalide
      if (msg.includes("410") || msg.includes("404") || msg.includes("not a valid") || msg.includes("unsubscribe")) {
        dropped++;
        await srv.from("push_subscriptions").delete().eq("user_id", n.parent_id);
      }
      await srv.from("notifications_queue")
        .update({
          status: "pending",          // on garde pending (rÃ©essaie au prochain cron)
          attempts: (Number(n.attempts) || 0) + 1,
          last_error: msg.slice(0, 300),
        })
      .eq("id", n.id);
    }
  }

  return NextResponse.json({ ok: true, attempted: rows.length, sent, dropped });
}
