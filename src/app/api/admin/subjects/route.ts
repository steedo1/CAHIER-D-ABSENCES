// src/app/api/admin/subjects/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Renvoie UNIQUEMENT les disciplines ACTIVÉES dans l’établissement courant,
 * pas tout le catalogue global.
 *
 * Format attendu par le front:
 *   { id: subjects.id, name: string, inst_subject_id: string }
 */
export async function GET() {
  const supa = await getSupabaseServerClient();

  // 1) Auth obligatoire
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Récupérer l’établissement de l’utilisateur courant
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ items: [] });
  }

  const institutionId = (me?.institution_id as string) || null;
  if (!institutionId) {
    return NextResponse.json({ items: [] });
  }

  // 3) On ne prend que les matières de CET établissement
  //    institution_subjects (1 par matière activée) -> subjects
  const { data, error } = await supa
    .from("institution_subjects")
    .select(
      `
      id,
      is_active,
      subject_id,
      subjects:subject_id (id, name)
    `
    )
    .eq("institution_id", institutionId)
    // si tu veux VRAIMENT n’afficher que celles actives
    .eq("is_active", true)
    .order("subject_id", { ascending: true });

  if (error) {
    return NextResponse.json({ items: [] });
  }

  const items: Array<{ id: string; name: string; inst_subject_id: string | null }> = [];

  for (const row of data ?? []) {
    const instId = String(row.id); // institution_subjects.id
    const subj = (row as any).subjects;
    const subjId = subj?.id ? String(subj.id) : String(row.subject_id);
    const subjName = subj?.name ? String(subj.name).trim() : "Matière";

    items.push({
      id: subjId,                 // <- subjects.id (global)
      name: subjName,
      inst_subject_id: instId,    // <- institution_subjects.id (ce que ton front attend)
    });
  }

  // Tri par nom pour l’affichage
  items.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return NextResponse.json({ items });
}
