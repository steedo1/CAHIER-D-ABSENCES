import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/super/institutions/students-count?ids=uuid1,uuid2,...
 * Réponse: { counts: { [institution_id]: number } }
 *
 * - Auth: super_admin
 * - Compte via v_student_person (si dispo), sinon fallback sur students.
 * - Optimisé pour être appelé page par page (20 IDs max typiquement).
 */
export async function GET(req: NextRequest) {
  // ðŸ” Auth + super_admin
  const s = await getSupabaseServerClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  const isSuper = (roles ?? []).some(r => r.role === "super_admin");
  if (!isSuper) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const srv = getSupabaseServiceClient();
  const url = new URL(req.url);
  const idsParam = (url.searchParams.get("ids") ?? "").trim();
  const ids = idsParam ? idsParam.split(",").map(x => x.trim()).filter(Boolean) : [];

  // Compte pour 1 établissement (view v_student_person puis fallback students)
  const countFor = async (instId: string): Promise<number> => {
    // 1) vue dédoublonnée (si tu l’as)
    const v = await srv
      .from("v_student_person")
      .select("*", { head: true, count: "exact" })
      .eq("institution_id", instId);

    if (!v.error) return v.count ?? 0;

    // 2) fallback table students
    const s2 = await srv
      .from("students")
      .select("id", { head: true, count: "exact" })
      .eq("institution_id", instId);

    return s2.count ?? 0;
  };

  const counts: Record<string, number> = {};
  if (ids.length) {
    await Promise.all(ids.map(async (id) => { counts[id] = await countFor(id); }));
  }

  return NextResponse.json({ counts }, { status: 200 });
}


