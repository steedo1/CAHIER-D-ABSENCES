import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  // Auth + Ã©tablissement
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id, display_name")
    .eq("id", user.id).maybeSingle();

  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const from      = searchParams.get("from");
  const to        = searchParams.get("to");
  const class_id  = searchParams.get("class_id"); // optionnel

  const student_id = ctx.params.id;

  // DÃ©tail des marques + discipline + libellÃ© classe
  // Discipline: on rÃ©sout via class_teachers (si dispo) sur la date de session
  const { data, error } = await srv
    .from("v_mark_effective_minutes")
    .select(`
      mark_id:mark_id,
      status,
      minutes_effective,
      started_at,
      ended_at,
      class_id,
      teacher_id,
      classes:class_id(label),
      t:teacher_id(
        id
      )
    `)
    .eq("student_id", student_id)
    .order("started_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Filtrage pÃ©riode et classe cÃ´tÃ© Node (plus souple sur la vue)
  let rows = (data ?? []).filter((r: any) => {
    const okFrom = from ? new Date(r.started_at) >= new Date(from) : true;
    const okTo   = to   ? new Date(r.started_at) <= new Date(to + "T23:59:59Z") : true;
    const okClass = class_id ? r.class_id === class_id : true;
    return okFrom && okTo && okClass;
  });

  // Cherche le subject name via class_teachers â†’ institution_subjects â†’ subjects
  // (best effort : si introuvable, on renvoie "â€”")
  const subjectNameByKey = new Map<string,string>();
  async function resolveSubject(class_id: string, teacher_id: string, iso: string): Promise<string> {
    const key = `${class_id}:${teacher_id}`;
    if (subjectNameByKey.has(key)) return subjectNameByKey.get(key)!;

    const { data: ct } = await srv
      .from("class_teachers")
      .select("subject_id, start_date, end_date")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .eq("teacher_id", teacher_id)
      .limit(1);

    let subjName = "â€”";
    const link = (ct ?? []).find((l:any) => {
      const d = iso.slice(0,10);
      const okStart = !l.start_date || d >= l.start_date;
      const okEnd   = !l.end_date   || d <= l.end_date;
      return okStart && okEnd;
    });

    if (link?.subject_id) {
      // subject_id peut pointer soit institution_subjects.id soit subjects.id selon tes donnÃ©es
      // On tente institution_subjects puis subjects
      const { data: instSubj } = await srv
        .from("institution_subjects")
        .select("custom_name, subjects:subject_id(name)")
        .eq("institution_id", inst)
        .or(`id.eq.${link.subject_id},subject_id.eq.${link.subject_id}`)
        .limit(1)
        .maybeSingle();

      subjName = instSubj?.custom_name || instSubj?.subjects?.name || "â€”";
    }

    subjectNameByKey.set(key, subjName);
    return subjName;
  }

  const items = await Promise.all(rows.map(async (r:any) => {
    const start = new Date(r.started_at);
    const end   = r.ended_at ? new Date(r.ended_at) :
      new Date(new Date(r.started_at).getTime() + (r.expected_minutes ?? r.minutes_effective)*60000);

    const subject_name = await resolveSubject(r.class_id, r.teacher_id, r.started_at);

    return {
      id: r.mark_id,
      date: start.toISOString().slice(0,10),
      start: start.toISOString(),
      end: end.toISOString(),
      rangeLabel: `${start.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}â€“${end.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`,
      class_label: r.classes?.label ?? "â€”",
      subject_name,
      status: r.status,
      minutes: r.minutes_effective,
    };
  }));

  const totalMinutes = items.reduce((a,i)=>a+i.minutes,0);

  return NextResponse.json({ items, totalMinutes }, { status: 200 });
}
