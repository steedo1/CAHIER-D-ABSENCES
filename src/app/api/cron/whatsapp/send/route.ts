// src/app/api/cron/whatsapp/send/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function assertCronAuth(req: Request) {
  const key = process.env.CRON_SECRET || "";
  const h   = req.headers.get("x-cron-key") || "";
  if (!key || h !== key) throw Object.assign(new Error("forbidden"), { status: 403 });
}

async function sendViaTwilioWhatsApp(toE164: string, body: string) {
  const sid   = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from  = process.env.TWILIO_WHATSAPP_FROM!; // ex: 'whatsapp:+14155238886'

  const form = new URLSearchParams();
  form.set("To",   `whatsapp:${toE164}`);
  form.set("From", from);
  form.set("Body", body);

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j?.message || "twilio_send_failed") as any;
    err.details = j;
    throw err;
  }
  return { providerId: j.sid as string };
}

export async function POST(req: Request) {
  try { assertCronAuth(req); } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  const srv = getSupabaseServiceClient();
  const limit = Number(process.env.WHATSAPP_BATCH_SIZE || 50);

  const { data: rows, error } = await srv
    .from("whatsapp_outbox")
    .select("id, to_phone_e164, body, try_count")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!rows?.length) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const m of rows) {
    try {
      const res = await sendViaTwilioWhatsApp(m.to_phone_e164 as string, m.body as string);

      await srv.from("whatsapp_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_msg_id: res.providerId,
          try_count: (m.try_count || 0) + 1,
          last_error: null,
        })
        .eq("id", m.id);

      sent++;
    } catch (e:any) {
      await srv.from("whatsapp_outbox")
        .update({
          status: (m.try_count || 0) >= 4 ? "failed" : "pending",
          try_count: (m.try_count || 0) + 1,
          last_error: e?.message?.slice(0, 500) || "send_failed",
        })
        .eq("id", m.id);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
