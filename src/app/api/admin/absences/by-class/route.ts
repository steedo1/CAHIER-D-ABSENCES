// src/app/api/admin/absences/by-class/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function startISO(d?: string) {
  return d ? new Date(`${d}T00:00:00.000Z`).toISOString() : "0001-01-01T00:00:00.000Z";
}
function endISO(d?: string) {
  return d ? new Date(`${d}T23:59:59.999Z`).toISOString() : "9999-12-31T23:59:59.999Z";
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from     = searchParams.get("from")     || "";
  const to       = searchParams.get("to")       || "";
  const class_id = searchParams.get("class_id") || "";

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const institution_id = (me?.institution_id as string) ?? null;
  if (!institution_id || !class_id) return NextResponse.json({ items: [] });

  // --- Absences (minutes) depuis v_mark_minutes
  const { data: absMarks, error: absErr } = await srv
    .from("v_mark_minutes")
    .select("student_id, minutes, started_at")
    .eq("institution_id", institution_id)
    .eq("class_id", class_id)
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (absErr) {
    return NextResponse.json({ items: [], error: absErr.message }, { status: 400 });
  }

  const absAgg = new Map<string, number>();
  for (const m of absMarks || []) {
    const sid = String((m as any).student_id);
    const v   = Number((m as any).minutes || 0);
    absAgg.set(sid, (absAgg.get(sid) || 0) + v);
  }

  // --- Retards (minutes) depuis v_tardy_minutes (si la vue existe)
  const tarAgg = new Map<string, number>();
  try {
    const { data: tardy } = await srv
      .from("v_tardy_minutes")
      .select("student_id, minutes, started_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .gte("started_at", startISO(from))
      .lte("started_at", endISO(to));

    for (const t of tardy || []) {
      const sid = String((t as any).student_id);
      const v   = Number((t as any).minutes || 0);
      tarAgg.set(sid, (tarAgg.get(sid) || 0) + v);
    }
  } catch {
    // Vue absente → on laisse tarAgg à 0
  }

  // --- Élèves (union des ids présents dans absences/retards)
  const stuIds = Array.from(new Set([...absAgg.keys(), ...tarAgg.keys()]));
  if (stuIds.length === 0) return NextResponse.json({ items: [] });

  const { data: students } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", stuIds.length ? stuIds : ["00000000-0000-0000-0000-000000000000"]);

  const nameOf = new Map<string, string>(
    (students || []).map(s => [
      s.id as string,
      [s.last_name, s.first_name].filter(Boolean).join(" ").trim() || "—",
    ])
  );

  // --- Assemblage (compat: minutes = absence_minutes)
  const items = stuIds.map((student_id) => {
    const absence_minutes = Number(absAgg.get(student_id) || 0);
    const tardy_minutes   = Number(tarAgg.get(student_id) || 0);
    const minutes_total   = absence_minutes + tardy_minutes;

    return {
      student_id,
      full_name: nameOf.get(student_id) || "—",
      minutes: absence_minutes,           // compat ancien champ
      absence_minutes,
      tardy_minutes,
      minutes_total,
    };
  }).sort((a, b) => b.minutes_total - a.minutes_total);

  return NextResponse.json({ items });
}
