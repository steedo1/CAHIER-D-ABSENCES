// src/app/api/cron/whatsapp/send/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────
   Auth Cron (on garde la même convention)
────────────────────────────────────────── */
function assertCronAuth(req: Request) {
  const key = process.env.CRON_SECRET || "";
  const h   = req.headers.get("x-cron-key") || "";
  if (!key || h !== key) throw Object.assign(new Error("forbidden"), { status: 403 });
}

/* ─────────────────────────────────────────
   [WHATSAPP ERADICATED]
   – Plus d’appel Twilio
   – Plus d’accès à whatsapp_outbox
   – Réponse no-op compatible avec l’existant
────────────────────────────────────────── */
export async function POST(req: Request) {
  try { assertCronAuth(req); } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  // No-op : on ne fait rien, on renvoie un succès neutre.
  return NextResponse.json({
    ok: true,
    sent: 0,
    note: "whatsapp_disabled",
  });
}

/*
  ─────────────────────────────────────────
  LEGACY (supprimé / laissé ici en mémo, désactivé)
  ─────────────────────────────────────────
  // import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
  // async function sendViaTwilioWhatsApp(...) { ... }
  // Lecture des messages 'pending' dans whatsapp_outbox puis envoi Twilio
  // Mise à jour status/try_count/last_error...
  // → TOUT CELA A ÉTÉ SUPPRIMÉ POUR ÉRADICER WHATSAPP
*/
