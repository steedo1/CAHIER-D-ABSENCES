// src/app/api/institution/slots/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hhmm(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeSlot(row: any) {
  const start = hhmm(row.start_time || row.start_hm);
  const duration = Number(row.duration_min ?? row.duration_minutes ?? 0);
  if (!start || !Number.isFinite(duration) || duration <= 0) return null;
  return {
    id: String(row.id),
    label: row.label || `Créneau ${row.period_no || row.order_index || ""}`.trim(),
    start_hm: start,
    duration_minutes: duration,
    weekday: row.weekday ?? null,
    period_no: row.period_no ?? row.order_index ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();
    const url = new URL(req.url);
    const classId = String(url.searchParams.get("class_id") || "").trim();

    let institutionId = "";

    if (classId) {
      const { data: cls, error } = await srv
        .from("classes")
        .select("id,institution_id")
        .eq("id", classId)
        .maybeSingle();
      if (error) return NextResponse.json({ items: [], error: error.message }, { status: 400 });
      institutionId = String(cls?.institution_id || "");
    }

    if (!institutionId) {
      const {
        data: { user },
        error: userErr,
      } = await supa.auth.getUser();
      if (userErr) return NextResponse.json({ items: [], error: userErr.message }, { status: 403 });
      if (!user) return NextResponse.json({ items: [], error: "unauthorized" }, { status: 401 });

      const { data: profile, error: profileErr } = await srv
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileErr) return NextResponse.json({ items: [], error: profileErr.message }, { status: 400 });
      institutionId = String(profile?.institution_id || "");
    }

    if (!institutionId) return NextResponse.json({ items: [] });

    // Source principale de Mon Cahier : créneaux officiels d'établissement.
    const { data: periods, error: periodErr } = await srv
      .from("institution_periods")
      .select("id,weekday,period_no,label,start_time,duration_min")
      .eq("institution_id", institutionId)
      .order("period_no", { ascending: true })
      .order("start_time", { ascending: true });

    if (!periodErr && periods?.length) {
      return NextResponse.json({
        items: periods.map(normalizeSlot).filter(Boolean),
      });
    }

    // Ancienne table éventuelle : conservée comme repli.
    const { data: legacy, error: legacyErr } = await srv
      .from("institution_session_slots")
      .select("id,label,start_hm,duration_minutes,active,order_index")
      .eq("institution_id", institutionId)
      .eq("active", true)
      .order("start_hm", { ascending: true })
      .order("order_index", { ascending: true });

    if (legacyErr) return NextResponse.json({ items: [], error: legacyErr.message }, { status: 400 });

    return NextResponse.json({
      items: (legacy || []).map(normalizeSlot).filter(Boolean),
    });
  } catch (e: any) {
    return NextResponse.json({ items: [], error: e?.message || "error" }, { status: 500 });
  }
}
