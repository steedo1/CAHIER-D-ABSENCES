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
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const class_id = searchParams.get("class_id") || "";

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const institution_id = (me?.institution_id as string) ?? null;
  if (!institution_id || !class_id) return NextResponse.json({ items: [] });

  // --- Absences (minutes) depuis v_mark_minutes (NON JUSTIFIÉES uniquement)
  const { data: absMarks, error: absErr } = await srv
    .from("v_mark_minutes")
    .select("id, student_id, minutes, started_at")
    .eq("institution_id", institution_id)
    .eq("class_id", class_id)
    .eq("status", "absent") // ✅ on ne garde que les absences, pas les retards
    .gte("started_at", startISO(from))
    .lte("started_at", endISO(to));

  if (absErr) {
    return NextResponse.json({ items: [], error: absErr.message }, { status: 400 });
  }

  // Récupérer les raisons pour ces marques
  const absMarkIds = Array.from(
    new Set(
      (absMarks || [])
        .map((m: any) => String(m.id || ""))
        .filter(Boolean),
    ),
  );

  let absReasonById = new Map<string, string | null>();
  if (absMarkIds.length) {
    const { data: marksInfo, error: marksInfoErr } = await srv
      .from("attendance_marks")
      .select("id, reason")
      .in("id", absMarkIds);

    if (marksInfoErr) {
      return NextResponse.json({ items: [], error: marksInfoErr.message }, { status: 400 });
    }

    absReasonById = new Map(
      (marksInfo || []).map((m: any) => [String(m.id), (m.reason ?? null) as string | null]),
    );
  }

  const absAgg = new Map<string, number>();
  const absCountAgg = new Map<string, number>();
  for (const m of absMarks || []) {
    const mark_id = String((m as any).id || "");
    const reason = String(absReasonById.get(mark_id) ?? "").trim();
    if (reason) continue; // ✅ absence justifiée → on ignore

    const sid = String((m as any).student_id);
    const v = Number((m as any).minutes || 0);
    if (!sid || !v) continue;
    absAgg.set(sid, (absAgg.get(sid) || 0) + v);
    absCountAgg.set(sid, (absCountAgg.get(sid) || 0) + 1);
  }

  // --- Retards (minutes) depuis v_tardy_minutes (NON JUSTIFIÉS uniquement)
  const tarAgg = new Map<string, number>();
  const tarCountAgg = new Map<string, number>();
  try {
    const { data: tardy } = await srv
      .from("v_tardy_minutes")
      .select("id, student_id, minutes, started_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .gte("started_at", startISO(from))
      .lte("started_at", endISO(to));

    const tarMarkIds = Array.from(
      new Set(
        (tardy || [])
          .map((t: any) => String(t.id || ""))
          .filter(Boolean),
      ),
    );

    let tarReasonById = new Map<string, string | null>();
    if (tarMarkIds.length) {
      const { data: tMarksInfo, error: tMarksInfoErr } = await srv
        .from("attendance_marks")
        .select("id, reason")
        .in("id", tarMarkIds);

      if (tMarksInfoErr) {
        return NextResponse.json({ items: [], error: tMarksInfoErr.message }, { status: 400 });
      }

      tarReasonById = new Map(
        (tMarksInfo || []).map((m: any) => [String(m.id), (m.reason ?? null) as string | null]),
      );
    }

    for (const t of tardy || []) {
      const mark_id = String((t as any).id || "");
      const reason = String(tarReasonById.get(mark_id) ?? "").trim();
      if (reason) continue; // ✅ retard justifié → on ignore

      const sid = String((t as any).student_id);
      const v = Number((t as any).minutes || 0);
      if (!sid || !v) continue;
      tarAgg.set(sid, (tarAgg.get(sid) || 0) + v);
      tarCountAgg.set(sid, (tarCountAgg.get(sid) || 0) + 1);
    }
  } catch {
    // Vue absente → on laisse tarAgg / tarCountAgg à 0
  }

  // --- Élèves (union des ids présents dans absences/retards non justifiés)
  const stuIds = Array.from(new Set([...absAgg.keys(), ...tarAgg.keys()]));
  if (stuIds.length === 0) return NextResponse.json({ items: [] });

  const { data: students } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", stuIds.length ? stuIds : ["00000000-0000-0000-0000-000000000000"]);

  const nameOf = new Map<string, string>(
    (students || []).map((s: any) => [
      s.id as string,
      [s.last_name, s.first_name].filter(Boolean).join(" ").trim() || "—",
    ]),
  );

  // --- Assemblage
  const items = stuIds
    .map((student_id) => {
      const absence_minutes = Number(absAgg.get(student_id) || 0);
      const absence_count = Number(absCountAgg.get(student_id) || 0);
      const tardy_minutes = Number(tarAgg.get(student_id) || 0);
      const tardy_count = Number(tarCountAgg.get(student_id) || 0);
      const minutes_total = absence_minutes + tardy_minutes;

      return {
        student_id,
        full_name: nameOf.get(student_id) || "—",
        minutes: absence_minutes, // compat ancien champ
        absence_minutes,
        absence_count,
        tardy_minutes,
        tardy_count,
        minutes_total,
      };
    })
    .sort((a, b) => b.minutes_total - a.minutes_total);

  return NextResponse.json({ items });
}
