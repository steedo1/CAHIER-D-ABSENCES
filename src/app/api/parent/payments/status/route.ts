// src/app/api/parent/payments/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const intentId = String(req.nextUrl.searchParams.get("intent_id") || "").trim();

  if (!intentId) {
    return NextResponse.json({ error: "intent_id manquant." }, { status: 400 });
  }

  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";
  if (!deviceId) {
    return NextResponse.json({ error: "Session parent introuvable." }, { status: 401 });
  }

  const { data: intent, error: intentErr } = await srv
    .schema("finance")
    .from("online_payment_intents")
    .select("id,student_id,status,amount,currency,provider,receipt_id,error_message,created_at,updated_at,confirmed_at")
    .eq("id", intentId)
    .maybeSingle();

  if (intentErr) return NextResponse.json({ error: intentErr.message }, { status: 400 });
  if (!intent) return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });

  const { data: link, error: linkErr } = await srv
    .from("parent_device_children")
    .select("student_id")
    .eq("device_id", deviceId)
    .eq("student_id", (intent as any).student_id)
    .maybeSingle();

  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 });
  if (!link) return NextResponse.json({ error: "Accès non autorisé." }, { status: 403 });

  return NextResponse.json({ item: intent });
}
