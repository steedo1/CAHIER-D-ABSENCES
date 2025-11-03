// src/app/api/whatsapp/dispatch/penalties/daily/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const waDisabled = () => {
  const v = String(process.env.WHATSAPP_ENABLED || "").trim().toLowerCase();
  return v === "" || v === "0" || v === "false" || v === "off" || v === "no";
};

function reqOk(req: Request) {
  const sec = (process.env.CRON_WHATSAPP_SECRET || "").trim();
  const hdr = (req.headers.get("x-cron-secret") || "").trim();
  const fromVercelCron = req.headers.has("x-vercel-cron");
  return fromVercelCron || (!!sec && hdr === sec);
}

async function getTwilioClient() {
  const { default: twilio } = await import("twilio");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  if (!sid || !token) throw new Error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

function toWhatsAppAddr(e164: string) {
  const n = (e164 || "").trim();
  if (!n.startsWith("+")) throw new Error("Invalid E164 phone (must start with +)");
  return `whatsapp:${n}`;
}

export async function POST(req: Request) {
  try {
    if (!reqOk(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // 🔕 Kill-switch global
    if (waDisabled()) return NextResponse.json({ sent: 0, skipped: 0, disabled: true });

    const srv = getSupabaseServiceClient();

    // Compacte d'abord (best-effort). Si tu préfères, tu peux aussi l’ignorer.
    try { await srv.rpc("f_whatsapp_compact_staged"); } catch {}

    // Récupère des messages pending
    const { data: pending, error: selErr } = await srv
      .from("whatsapp_outbox")
      .select("id, to_e164, body, meta, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    if (selErr) throw selErr;
    if (!pending?.length) return NextResponse.json({ sent: 0, skipped: 0 });

    // Réservation anti-doublon
    const ids = pending.map(r => r.id);
    const { data: claimed, error: claimErr } = await srv
      .from("whatsapp_outbox")
      .update({ status: "processing", meta: { locked_at: new Date().toISOString() } })
      .in("id", ids)
      .eq("status", "pending")
      .select("id, to_e164, body, meta, created_at");
    if (claimErr) throw claimErr;
    const rows = claimed || [];
    if (!rows.length) return NextResponse.json({ sent: 0, skipped: 0 });

    // Envoi Twilio (gardé mais jamais atteint si kill-switch actif)
    const client = await getTwilioClient();
    const fromCfg = (process.env.TWILIO_WHATSAPP_FROM || "").trim();
    if (!fromCfg) throw new Error("Missing TWILIO_WHATSAPP_FROM");
    const from = `whatsapp:${fromCfg.startsWith("+") ? fromCfg : `+${fromCfg}`.replace("++", "+")}`;

    let sent = 0, skipped = 0;
    for (const row of rows) {
      try {
        const to = toWhatsAppAddr(String(row.to_e164));
        const body = String(row.body || "").slice(0, 1600);
        const { default: twilio } = await import("twilio"); // no-op import to satisfy bundlers
        const client = await getTwilioClient();
        const msg = await client.messages.create({ from, to, body });

        await getSupabaseServiceClient()
          .from("whatsapp_outbox")
          .update({
            status: "sent",
            meta: { ...(row.meta ?? {}), twilio_sid: msg.sid, sent_at: new Date().toISOString() },
          })
          .eq("id", row.id);

        sent++;
      } catch (err: any) {
        await getSupabaseServiceClient()
          .from("whatsapp_outbox")
          .update({
            status: "error",
            meta: { ...(row.meta ?? {}), error: String(err?.message || err), failed_at: new Date().toISOString() },
          })
          .eq("id", row.id);
        skipped++;
      }
    }

    return NextResponse.json({ sent, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "dispatch_failed" }, { status: 500 });
  }
}
