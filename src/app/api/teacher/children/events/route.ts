//src/api/teacher/children/events/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/** Résout un tableau d'IDs de matière (subjects.id OU institution_subjects.id) â†’ libellés */
async function resolveSubjectNames(srv: any, ids: string[]) {
  const map = new Map<string, string>();
  if (!ids.length) return map;

  // institution_subjects par id
  const { data: instSubs } = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(name)")
    .in("id", ids);

  for (const r of instSubs || []) {
    const id  = String(r.id);
    const nm  = (r as any).custom_name || (r as any).subjects?.name || null;
    if (nm) map.set(id, nm);
    const baseId = (r as any).subject_id as string | null;
    if (baseId && nm && !map.has(baseId)) map.set(baseId, nm);
  }

  // fallback subjects (pour les ids de base restants)
  const missingBase = ids.filter(x => !map.has(x));
  if (missingBase.length) {
    const { data: subs } = await srv.from("subjects").select("id,name").in("id", missingBase);
    for (const s of subs || []) map.set(String(s.id), String((s as any).name ?? "—"));
  }
  return map;
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();   // RLS (user + établissement)
  const srv  = getSupabaseServiceClient();        // service (requêtes libres)

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  const inst = (me?.institution_id as string) || null;
  if (!inst) return NextResponse.json({ items: [] });

  const url = new URL(req.url);
  const student_id = url.searchParams.get("student_id") || "";
  const days = Math.max(1, Math.min(120, parseInt(url.searchParams.get("days") || "45", 10))); // fenêtre récente

  if (!student_id) return NextResponse.json({ items: [], error: "student_id required" }, { status: 400 });

  // Autorisation : ce parent doit être lié Ã  l'élève
  const { data: link } = await srv
    .from("student_guardians")
    .select("student_id")
    .eq("institution_id", inst)
    .eq("parent_id", user.id)
    .eq("student_id", student_id)
    .maybeSingle();

  if (!link) return NextResponse.json({ items: [] }); // pas lié â†’ rien

  // Fenêtre temporelle
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();

  // On lit directement les marques + leur session (pour récupérer date/discipline/classe)
  const { data: rows, error } = await srv
    .from("attendance_marks")
    .select(`
      id,
      status,
      minutes_late,
      session:session_id (
        started_at,
        class_id,
        subject_id,
        institution_id
      )
    `)
    .eq("student_id", student_id)
    .gte("session.started_at", from);

  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 400 });

  // On garde uniquement absences & retards
  const useful = (rows || []).filter(r => (r as any).status === "absent" || (r as any).status === "late");

  // Libellés classes
  const classIds = Array.from(new Set(useful.map(r => String((r as any).session?.class_id)).filter(Boolean)));
  const { data: classes } = await srv.from("classes").select("id,label").in("id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);
  const className = new Map<string, string>((classes || []).map(c => [String(c.id), String((c as any).label ?? "")]));

  // Libellés matières
  const subjIds = Array.from(new Set(useful.map(r => String((r as any).session?.subject_id)).filter(Boolean)));
  const subjName = await resolveSubjectNames(srv, subjIds);

  // Mapping final (tri recent â†’ ancien)
  const items = useful
    .map(r => {
      const s = (r as any).session || {};
      const started = String(s.started_at || new Date().toISOString());
      const type = (r as any).status === "absent" ? "absent" : "late";
      const class_label = s.class_id ? (className.get(String(s.class_id)) || null) : null;
      const subject_name = s.subject_id ? (subjName.get(String(s.subject_id)) || null) : null;
      return {
        id: String((r as any).id),
        when: started,
        type,
        minutes_late: type === "late" ? Number((r as any).minutes_late || 0) : null,
        class_label,
        subject_name
      };
    })
    .sort((a, b) => b.when.localeCompare(a.when));

  return NextResponse.json({ items });
}


