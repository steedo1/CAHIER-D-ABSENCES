// src/app/api/super/institutions/[id]/renew/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addMonthsISO(dateISO: string, months: number) {
  const d = new Date(dateISO);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // ← Next 15: params est une Promise
) {
  const { id } = await params; // ← destructuring avec await

  const supabase = getSupabaseServiceClient();
  const body = await req.json().catch(() => ({} as any));

  const monthsRaw = Number(body?.months);
  const to: string | undefined =
    typeof body?.to === "string" ? body.to.trim() : undefined;

  const { data: inst, error: gErr } = await supabase
    .from("institutions")
    .select("subscription_expires_at")
    .eq("id", id)
    .maybeSingle();
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const base =
    inst?.subscription_expires_at && inst.subscription_expires_at > today
      ? inst.subscription_expires_at
      : today;

  let next = base;
  if (to) {
    next = to;
  } else {
    const m = Number.isFinite(monthsRaw) ? Math.trunc(monthsRaw) : 12;
    next = addMonthsISO(base, m > 0 ? m : 12);
  }

  const { error: uErr, data } = await supabase
    .from("institutions")
    .update({ subscription_expires_at: next })
    .eq("id", id)
    .select("id, subscription_expires_at")
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

  return NextResponse.json({ item: data });
}
