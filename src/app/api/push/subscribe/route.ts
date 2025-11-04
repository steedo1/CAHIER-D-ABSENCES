//src/app/api/push/subscribe/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERBOSE = (process.env.VERBOSE_PUSH || "1") !== "0";
function log(stage: string, meta: Record<string, unknown>) { if (VERBOSE) console.info(`[push/subscribe] ${stage}`, meta); }

type Body = {
  platform?: string;
  device_id?: string;
  subscription?: any;
  fcm_token?: string;
};

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  try {
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized", stage: "auth" }, { status: 401 });

    let body: Body | null = null;
    try { body = await req.json(); } catch (e: any) {
      return NextResponse.json({ error: "invalid_json", stage: "parse" }, { status: 400 });
    }
    if (!body) return NextResponse.json({ error: "empty_body", stage: "parse" }, { status: 400 });

    let platform = String(body.platform || "").toLowerCase().trim();
    if (!platform) {
      if (body.subscription?.endpoint) platform = "web";
      else if (body.fcm_token) platform = "android";
    }
    if (!["web","android","ios"].includes(platform)) {
      return NextResponse.json({ error: "unknown_platform", stage: "preflight" }, { status: 400 });
    }

    const now = new Date().toISOString();
    let deviceId = String(body.device_id || "").trim();
    const row: any = { user_id: user.id, platform, last_seen_at: now };

    if (platform === "web") {
      const sub = body.subscription;
      const ok = !!sub?.endpoint && !!sub?.keys?.p256dh && !!sub?.keys?.auth;
      if (!ok) return NextResponse.json({ error: "missing_or_invalid_subscription", stage: "preflight" }, { status: 400 });
      deviceId = deviceId || String(sub.endpoint);
      row.device_id = deviceId;
      row.subscription_json = sub;
    } else {
      const token = String(body.fcm_token || "").trim();
      if (!token) return NextResponse.json({ error: "missing_fcm_token", stage: "preflight" }, { status: 400 });
      row.fcm_token = token;
      row.device_id = deviceId || token;
    }

    const onConflict = "user_id,platform,device_id";
    const up = await srv.from("push_subscriptions").upsert(row, { onConflict, ignoreDuplicates: false });
    if (up.error) {
      // fallback UPDATE→INSERT si pas de contrainte
      const upd = await srv
        .from("push_subscriptions")
        .update(row)
        .match({ user_id: user.id, platform, device_id: row.device_id })
        .select("user_id");
      if (upd.error || !upd.data?.length) {
        const ins = await srv.from("push_subscriptions").insert(row).select("user_id");
        if (ins.error) return NextResponse.json({ error: ins.error.message, stage: "insert" }, { status: 400 });
        return NextResponse.json({ ok: true, mode: "insert", platform, device_id: row.device_id });
      }
      return NextResponse.json({ ok: true, mode: "update", platform, device_id: row.device_id });
    }
    return NextResponse.json({ ok: true, mode: "upsert", platform, device_id: row.device_id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e), stage: "unhandled" }, { status: 500 });
  }
}
