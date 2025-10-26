import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * GET /api/teacher/roster?class_id=UUID
 * Retourne la liste des élèves de la classe (triés), avec { id, full_name, matricule }.
 * Accès autorisé si l'enseignant a une séance ouverte sur cette classe
 * ou s'il est affecté Ã  cette classe dans l'établissement.
 */
export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const class_id = url.searchParams.get("class_id") || "";
  if (!class_id) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  // établissement de l'enseignant
  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ items: [] });

  // autorisation :
  // 1) séance ouverte sur cette classe
  const { data: os } = await supa
    .from("teacher_sessions")
    .select("id,class_id")
    .eq("teacher_id", user.id)
    .is("ended_at", null)
    .maybeSingle();

  let allowed = !!os && (os as any).class_id === class_id;

  // 2) ou affectation Ã  la classe
  if (!allowed) {
    const { data: link } = await supa
      .from("class_teachers")
      .select("id")
      .eq("teacher_id", user.id)
      .eq("class_id", class_id)
      .eq("institution_id", inst)
      .limit(1)
      .maybeSingle();
    allowed = !!link;
  }
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // élèves inscrits (actifs)
  const { data, error } = await supa
    .from("class_enrollments")
    .select(`
      student_id,
      students:student_id ( id, first_name, last_name, matricule )
    `)
    .eq("class_id", class_id)
    .is("end_date", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // map + tri "Nom puis Prénom"
  const items = (data ?? [])
    .map((row: any) => {
      const s = row.students || {};
      const full = [s.last_name, s.first_name].filter(Boolean).join(" ").trim() || "—";
      return {
        id: s.id as string,
        full_name: full,
        matricule: s.matricule || null,
      };
    })
    .sort((a: any, b: any) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" })
    );

  return NextResponse.json({ items });
}


