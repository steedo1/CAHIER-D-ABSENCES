//src/app/api/parent/children/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const supa = await getSupabaseServerClient(); // RLS (cookies)
  const srv  = getSupabaseServiceClient();      // service (no RLS)

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  // 1) liens parent -> Ã©lÃ¨ves
  const { data: links, error: lErr } = await srv
    .from("student_guardians")
    .select("student_id")
    .eq("parent_id", user.id);

  if (lErr) return NextResponse.json({ items: [], error: lErr.message }, { status: 400 });

  const studentIds = Array.from(new Set((links || []).map(r => String(r.student_id))));
  if (!studentIds.length) return NextResponse.json({ items: [] });

  // 2) Ã©lÃ¨ves
  const { data: studs } = await srv
    .from("students")
    .select("id, first_name, last_name")
    .in("id", studentIds);

  // 3) inscription active -> classe
  const { data: enrolls } = await srv
    .from("class_enrollments")
    .select("student_id, classes:class_id(label)")
    .in("student_id", studentIds)
    .is("end_date", null);

  const clsByStudent = new Map<string, string>();
  for (const e of enrolls || []) {
    clsByStudent.set(String(e.student_id), String((e as any).classes?.label ?? ""));
  }

  const items = (studs || [])
    .map(s => ({
      id: String(s.id),
      full_name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "â€”",
      class_label: clsByStudent.get(String(s.id)) || null,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));

  return NextResponse.json({ items });
}


