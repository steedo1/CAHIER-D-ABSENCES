import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function okAuth(req: Request) {
  // Unifie CRON_SECRET et CRON_PUSH_SECRET pour éviter les confusions
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();

  // Accept both: x-cron-secret and Authorization: Bearer <token>
  const xCron = (req.headers.get("x-cron-secret") || "").trim();
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const fromVercelCron = req.headers.has("x-vercel-cron"); // Vercel Scheduled Cron

  return fromVercelCron || (!!secret && (xCron === secret || bearer === secret));
}

function ensureWebPushConfigured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !prv) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
  }
  webpush.setVapidDetails("mailto:no-reply@example.com", pub, prv);
}

async function run(req: Request) {
  if (!okAuth(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    ensureWebPushConfigured();
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  const srv = getSupabaseServiceClient();

  const { data: rows, error: pickErr } = await srv
    .from("notifications_queue")
    .select("id, parent_id, channels, payload, status, attempts")
    .eq("status", "pending")
    .contains("channels", ["push"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (pickErr) return NextResponse.json({ ok: false, error: pickErr.message }, { status: 400 });
  if (!rows?.length) return NextResponse.json({ ok: true, attempted: 0, sent: 0, dropped: 0 });

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

    const title = n.payload?.title ?? (n.payload?.event === "absent" ? "Absence" : "Notification");
    const body  = n.payload?.body  ?? "";
    const url   = "/parents";

    const pushPayload = JSON.stringify({ title, body, url, data: n.payload || {} });

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
      // Si l'abonnement est invalide, on purge les subs de l'utilisateur
      if (/(410|404|not a valid|unsubscribe)/i.test(msg)) {
        dropped++;
        await srv.from("push_subscriptions").delete().eq("user_id", n.parent_id);
      }
      await srv.from("notifications_queue")
        .update({
          status: "pending",
          attempts: (Number(n.attempts) || 0) + 1,
          last_error: msg.slice(0, 300),
        })
        .eq("id", n.id);
    }
  }

  return NextResponse.json({ ok: true, attempted: rows.length, sent, dropped });
}

export const GET = run;   // Vercel Cron peut faire GET
export const POST = run;  // et/ou POST manuel
