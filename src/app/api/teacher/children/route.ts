//src/api/teacher/children/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const supa = await getSupabaseServerClient();   // RLS (pour connaÃ®tre l'utilisateur et son Ã©tablissement)
  const srv  = getSupabaseServiceClient();        // service (pas de RLS) pour faire les jointures simplement

  // Utilisateur connectÃ©
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  // Etablissement de l'utilisateur
  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  const inst = (me?.institution_id as string) || null;
  if (!inst) return NextResponse.json({ items: [] });

  // 1) Tous les student_id liÃ©s Ã  ce parent
  const { data: links, error: lErr } = await srv
    .from("student_guardians")
    .select("student_id")
    .eq("parent_id", user.id)
    .eq("institution_id", inst);

  if (lErr) return NextResponse.json({ items: [], error: lErr.message }, { status: 400 });
  const studentIds = Array.from(new Set((links || []).map(r => String(r.student_id))));
  if (!studentIds.length) return NextResponse.json({ items: [] });

  // 2) Noms des Ã©lÃ¨ves
  const { data: studs } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", studentIds);

  // 3) Classe en cours (inscription active)
  const { data: enrolls } = await srv
    .from("class_enrollments")
    .select("student_id, classes:class_id(label)")
    .in("student_id", studentIds)
    .is("end_date", null);

  const classLabelByStudent = new Map<string, string>();
  for (const e of enrolls || []) {
    classLabelByStudent.set(String(e.student_id), String((e as any).classes?.label ?? ""));
  }

  const items = (studs || []).map(s => ({
    id: String(s.id),
    full_name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "â€”",
    class_label: classLabelByStudent.get(String(s.id)) || null,
  }));

  // Tri alpha
  items.sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));

  return NextResponse.json({ items });
}


