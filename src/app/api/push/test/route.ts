//src/app/api/push/test/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import webpush from "web-push";

function cfg() {
  const pub = process.env.VAPID_PUBLIC_KEY!, prv = process.env.VAPID_PRIVATE_KEY!;
  webpush.setVapidDetails(`mailto:no-reply@example.com`, pub, prv);
}

export async function POST() {
  try {
    cfg();
    const supa = await getSupabaseServerClient();
    const srv  = getSupabaseServiceClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: sub } = await srv.from("push_subscriptions").select("subscription_json").eq("user_id", user.id).maybeSingle();
    if (!sub) return NextResponse.json({ error: "no_subscription" }, { status: 400 });

    const payload = JSON.stringify({
      title: process.env.PUSH_SENDER_NAME || "Notification",
      body:  "Ceci est un test âœ…",
      url: "/parent"
    });
    await webpush.sendNotification(sub.subscription_json as any, payload);
    return NextResponse.json({ ok: true });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "push_failed" }, { status: 400 });
  }
}


