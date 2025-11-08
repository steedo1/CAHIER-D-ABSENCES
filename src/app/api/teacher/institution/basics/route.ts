// src/app/api/teacher/institution/basics/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // ✅ IMPORTANT : attendre le client
  const supabase = await getSupabaseServerClient();

  // 1) Qui est connecté ?
  const { data: me, error: uerr } = await supabase.auth.getUser();
  if (uerr || !me?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Institution du profil
  const { data: prof, error: perr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", me.user.id)
    .maybeSingle();

  if (perr) {
    return NextResponse.json({ error: perr.message }, { status: 400 });
  }
  if (!prof?.institution_id) {
    // Fallback très safe
    return NextResponse.json({
      tz: "Africa/Abidjan",
      default_session_minutes: 60,
      auto_lateness: true,
      periods: [],
    });
  }

  const instId = prof.institution_id;

  // 3) Paramètres d’établissement
  const { data: inst, error: ierr } = await supabase
    .from("institutions")
    .select("tz, default_session_minutes, auto_lateness")
    .eq("id", instId)
    .maybeSingle();

  if (ierr) {
    return NextResponse.json({ error: ierr.message }, { status: 400 });
  }

  // 4) Créneaux (tous les jours), triés
  const { data: periods, error: perr2 } = await supabase
    .from("institution_periods")
    .select("weekday, label, start_time, end_time")
    .eq("institution_id", instId)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (perr2) {
    return NextResponse.json({ error: perr2.message }, { status: 400 });
  }

  return NextResponse.json({
    tz: inst?.tz ?? "Africa/Abidjan",
    default_session_minutes: Number(inst?.default_session_minutes ?? 60),
    auto_lateness: !!inst?.auto_lateness,
    periods: periods ?? [],
  });
}
