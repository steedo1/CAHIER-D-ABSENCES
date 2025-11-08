//src/app/api/admin/parents/links/routes.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | null;

  // �S& durcissement : institution obligatoire
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const url = new URL(req.url);
  const class_id = url.searchParams.get("class_id") || "";
  if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  const { data: cls, error: cErr } = await srv
    .from("classes")
    .select("id,institution_id,label")
    .eq("id", class_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  const { data: enrolls, error: eErr } = await srv
    .from("class_enrollments")
    .select("student_id, students:student_id(id, first_name, last_name)")
    .eq("class_id", class_id);
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

  const studentIds = (enrolls || []).map((r: any) => r.student_id as string);
  if (studentIds.length === 0) return NextResponse.json({ items: [] });

  const { data: links, error: lErr } = await srv
    .from("student_guardians")
    .select("parent_id, student_id, notifications_enabled, profiles:parent_id(id, display_name, email, phone)")
    .in("student_id", studentIds);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 400 });

  const byStudent = new Map<
    string,
    {
      student_id: string;
      student_name: string;
      guardians: Array<{
        profile_id: string;
        display_name: string | null;
        phone: string | null;
        email: string | null;
        notifications_enabled: boolean;
      }>
    }
  >();

  for (const r of (enrolls || [])) {
    const s = (r as any).students;
    const full = `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim() || "�";
    byStudent.set(r.student_id, { student_id: r.student_id, student_name: full, guardians: [] });
  }

  for (const ln of (links || [])) {
    const stId = (ln as any).student_id as string;
    if (!byStudent.has(stId)) continue;

    const p = (ln as any).profiles || {};
    // �S& durcissement : ignorer un lien orphelin sans profil parent
    if (!p?.id) continue;

    byStudent.get(stId)!.guardians.push({
      profile_id: p.id,
      display_name: p.display_name ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
      notifications_enabled: (ln as any).notifications_enabled === true,
    });
  }

  return NextResponse.json({ items: Array.from(byStudent.values()) });
}




