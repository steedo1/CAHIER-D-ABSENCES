// src/app/api/parent/payments/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function attachReceiptNo(srv: ReturnType<typeof getSupabaseServiceClient>, item: any) {
  const receiptId = clean(item?.receipt_id);
  if (!receiptId) return { ...item, receipt_no: null };

  const { data: receipt, error } = await srv
    .schema("finance")
    .from("receipts")
    .select("id,receipt_no")
    .eq("id", receiptId)
    .maybeSingle();

  if (error) {
    console.warn("[parent.payments.status.receipt]", error.message);
    return { ...item, receipt_no: null };
  }

  return {
    ...item,
    receipt_no: clean((receipt as any)?.receipt_no) || null,
  };
}

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
    .select("id,student_id,status,amount,currency,provider,receipt_id,error_message,created_at,updated_at,expires_at,confirmed_at,failed_at")
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

  const currentStatus = String((intent as any).status || "").trim();
  const expiresAt = (intent as any).expires_at ? new Date((intent as any).expires_at).getTime() : 0;
  const isExpired = expiresAt > 0 && expiresAt < Date.now();

  if (["initiated", "pending"].includes(currentStatus) && isExpired && !(intent as any).receipt_id) {
    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await srv
      .schema("finance")
      .from("online_payment_intents")
      .update({
        status: "expired",
        error_message: "Paiement expiré automatiquement : confirmation opérateur non reçue dans le délai.",
        failed_at: nowIso,
        updated_at: nowIso,
      } as any)
      .eq("id", intentId)
      .in("status", ["initiated", "pending"])
      .select("id,student_id,status,amount,currency,provider,receipt_id,error_message,created_at,updated_at,expires_at,confirmed_at,failed_at")
      .maybeSingle();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });
    if (updated) return NextResponse.json({ item: await attachReceiptNo(srv, updated) });
  }

  return NextResponse.json({ item: await attachReceiptNo(srv, intent) });
}
