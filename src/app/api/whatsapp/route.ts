// src/app/api/whatsapp/compact/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────
   Auth Cron (inchangé)
────────────────────────────────────────── */
function okFromCron(req: NextRequest) {
  const sec = (process.env.CRON_WHATSAPP_SECRET || "").trim();
  const hdr = (req.headers.get("x-cron-secret") || "").trim();
  const fromVercel = req.headers.has("x-vercel-cron");
  return fromVercel || (!!sec && hdr === sec);
}

/* ─────────────────────────────────────────
   [WHATSAPP ERADICATED]
   – Plus d’appel RPC Supabase (f_whatsapp_compact_staged)
   – Plus d’accès à whatsapp_outbox
   – Réponse no-op compatible avec l’existant
────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  if (!okFromCron(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // No-op : on ne fait rien, on renvoie un succès neutre.
  return NextResponse.json({
    ok: true,
    grouped: 0,
    note: "whatsapp_disabled",
  });
}

/*
  ─────────────────────────────────────────
  LEGACY (supprimé / mémo, désactivé)
  ─────────────────────────────────────────
  // import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
  // const srv = getSupabaseServiceClient();
  // const { data, error } = await srv.rpc("f_whatsapp_compact_staged");
  // if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // return NextResponse.json({ grouped: data ?? 0 });
*/
