// src/app/api/admin/students/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  const inst = me?.institution_id as string;
  if (!inst) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const level = searchParams.get("level");

  // On récupère les inscriptions actives avec les infos élève + classe
  const { data, error } = await supa
    .from("class_enrollments")
    .select(`
      student_id,
      class_id,
      students:student_id ( id, first_name, last_name, institution_id, matricule ),
      classes:class_id   ( id, label, level, institution_id )
    `)
    .eq("institution_id", inst)
    .is("end_date", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let items = (data ?? []).map((row: any) => {
    const s = row.students || {};
    const c = row.classes || {};
    const full = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—";
    return {
      id: s.id as string,
      full_name: full,
      class_id: row.class_id as string,
      class_label: c.label ?? null,
      matricule: s.matricule ?? null,
      level: c.level ?? null,
    };
  });

  // Filtres optionnels côté serveur (ne cassent pas l’existant)
  if (classId) items = items.filter((x) => x.class_id === classId);
  if (level) items = items.filter((x) => (x as any).level === level);

  return NextResponse.json({ items });
}
