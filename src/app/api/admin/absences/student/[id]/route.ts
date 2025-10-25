import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: student_id } = await context.params;

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  // Auth + établissement
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const class_id = searchParams.get("class_id"); // optionnel

  // Détail des marques + discipline + libellé classe
  const { data, error } = await srv
    .from("v_mark_effective_minutes")
    .select(
      `
      mark_id:mark_id,
      status,
      minutes_effective,
      started_at,
      ended_at,
      class_id,
      teacher_id,
      classes:class_id(label),
      t:teacher_id(id)
    `
    )
    .eq("student_id", student_id)
    .order("started_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Filtrage période et classe côté Node (laisser en any pour éviter TS2769)
  const rows = (data ?? []).filter((r: any) => {
    const okFrom = from ? new Date(r.started_at) >= new Date(from) : true;
    const okTo = to ? new Date(r.started_at) <= new Date(to + "T23:59:59Z") : true;
    const okClass = class_id ? r.class_id === class_id : true;
    return okFrom && okTo && okClass;
  });

  // Résolution discipline via class_teachers → institution_subjects → subjects
  const subjectNameByKey = new Map<string, string>();
  async function resolveSubject(class_id: string, teacher_id: string, iso: string): Promise<string> {
    const key = `${class_id}:${teacher_id}`;
    if (subjectNameByKey.has(key)) return subjectNameByKey.get(key)!;

    const { data: ct } = await srv
      .from("class_teachers")
      .select("subject_id, start_date, end_date")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .eq("teacher_id", teacher_id);

    let subjName = "—";
    const link = (ct ?? []).find((l: any) => {
      const d = iso.slice(0, 10);
      const okStart = !l.start_date || d >= l.start_date;
      const okEnd = !l.end_date || d <= l.end_date;
      return okStart && okEnd;
    });

    if (link?.subject_id) {
      const { data: instSubj } = await srv
        .from("institution_subjects")
        .select("custom_name, subjects:subject_id(name)")
        .eq("institution_id", inst)
        .or(`id.eq.${link.subject_id},subject_id.eq.${link.subject_id}`)
        .limit(1)
        .maybeSingle();

      // subjects peut être un objet OU un tableau selon la relation
      const rel: any = instSubj?.subjects;
      const relName = Array.isArray(rel) ? rel[0]?.name : rel?.name;
      subjName = instSubj?.custom_name || relName || "—";
    }

    subjectNameByKey.set(key, subjName);
    return subjName;
  }

  const items = await Promise.all(
    (rows as any[]).map(async (r) => {
      const start = new Date(r.started_at);
      const expected = (r as any).expected_minutes ?? r.minutes_effective;
      const end = r.ended_at
        ? new Date(r.ended_at)
        : new Date(new Date(r.started_at).getTime() + (expected || 0) * 60000);

      const subject_name = await resolveSubject(r.class_id, r.teacher_id, r.started_at);

      // classes peut être un objet OU un tableau → normaliser
      const classLabel = Array.isArray(r.classes) ? r.classes[0]?.label : r.classes?.label;

      return {
        id: r.mark_id,
        date: start.toISOString().slice(0, 10),
        start: start.toISOString(),
        end: end.toISOString(),
        rangeLabel: `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString(
          [],
          { hour: "2-digit", minute: "2-digit" }
        )}`,
        class_label: classLabel ?? "—",
        subject_name,
        status: r.status,
        minutes: r.minutes_effective,
      };
    })
  );

  const totalMinutes = items.reduce((a, i) => a + i.minutes, 0);

  return NextResponse.json({ items, totalMinutes }, { status: 200 });
}
