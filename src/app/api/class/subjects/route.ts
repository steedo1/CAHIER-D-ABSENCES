// src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubjectItem = {
  id: string; // id à renvoyer au front (institution_subjects.id si possible, sinon subjects.id)
  label: string;
};

export async function GET(req: NextRequest) {
  try {
    // ✅ 0) Auth obligatoire (server client)
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED", items: [] as SubjectItem[] },
        { status: 401 }
      );
    }

    // ✅ 0bis) Institution du user + rôle
    const { data: roleRow, error: roleErr } = await supabase
      .from("user_roles")
      .select("institution_id, role")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (
      roleErr ||
      !roleRow ||
      !roleRow.institution_id ||
      !["super_admin", "admin", "teacher"].includes(roleRow.role)
    ) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", items: [] as SubjectItem[] },
        { status: 403 }
      );
    }

    const userInstitutionId = roleRow.institution_id as string;

    // ✅ 1) Params
    const srv = getSupabaseServiceClient(); // on le garde (comme avant) mais on verrouille institution + class
    const url = new URL(req.url);

    const class_id = (url.searchParams.get("class_id") ?? "").trim();
    if (!class_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    /* ───────── 2) Classe : DOIT appartenir à l’établissement du user ───────── */
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id, institution_id, academic_year")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      console.error("[class.subjects] classes error", clsErr);
      return NextResponse.json(
        { error: clsErr.message ?? "classes error" },
        { status: 400 }
      );
    }
    if (!cls) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const institution_id = cls.institution_id as string | null;
    const academic_year = (cls as any).academic_year as string | null;

    // ✅ verrouillage anti fuite inter-établissements
    if (!institution_id || institution_id !== userInstitutionId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN_CLASS", items: [] as SubjectItem[] },
        { status: 403 }
      );
    }

    /* ───────── 3) Récupérer tous les subject_id liés à la classe ───────── */
    const subjectIdSet = new Set<string>();

    // 3a) Matières affectées à la classe (class_teachers)
    {
      const { data, error } = await srv
        .from("class_teachers")
        .select("subject_id")
        .eq("class_id", class_id)
        .eq("institution_id", institution_id);

      if (error) {
        console.error("[class.subjects] class_teachers error", error);
      } else {
        for (const row of data ?? []) {
          const sid = (row as any).subject_id as string | null;
          if (sid) subjectIdSet.add(sid);
        }
      }
    }

    // 3b) Matières pour lesquelles il y a déjà des notes (grade_flat_marks)
    {
      let q = srv
        .from("grade_flat_marks")
        .select("subject_id")
        .eq("class_id", class_id)
        .eq("institution_id", institution_id);

      if (academic_year) {
        q = q.eq("academic_year", academic_year);
      }

      const { data, error } = await q;

      if (error) {
        console.error("[class.subjects] grade_flat_marks error", error);
      } else {
        for (const row of data ?? []) {
          const sid = (row as any).subject_id as string | null;
          if (sid) subjectIdSet.add(sid);
        }
      }
    }

    // Si aucune matière liée à la classe → vide
    if (subjectIdSet.size === 0) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const subjectIds = Array.from(subjectIdSet);

    /* ───────── 4) Retrouver les lignes institution_subjects ───────── */
    const instRows: any[] = [];
    const instSeen = new Set<string>();

    // 4a) institution_subjects où id ∈ subjectIds
    {
      const { data, error } = await srv
        .from("institution_subjects")
        .select("id, subject_id, custom_name, subjects:subject_id(name)")
        .eq("institution_id", institution_id)
        .in("id", subjectIds);

      if (error) {
        console.error("[class.subjects] institution_subjects by id error", error);
      } else {
        for (const row of data ?? []) {
          const r: any = row;
          if (r?.id && !instSeen.has(r.id)) {
            instRows.push(r);
            instSeen.add(r.id);
          }
        }
      }
    }

    // 4b) institution_subjects où subject_id ∈ subjectIds
    {
      const { data, error } = await srv
        .from("institution_subjects")
        .select("id, subject_id, custom_name, subjects:subject_id(name)")
        .eq("institution_id", institution_id)
        .in("subject_id", subjectIds);

      if (error) {
        console.error(
          "[class.subjects] institution_subjects by subject_id error",
          error
        );
      } else {
        for (const row of data ?? []) {
          const r: any = row;
          if (r?.id && !instSeen.has(r.id)) {
            instRows.push(r);
            instSeen.add(r.id);
          }
        }
      }
    }

    // Ensemble des subjectIds déjà couverts
    const coveredSubjectIds = new Set<string>();
    for (const r of instRows) {
      const sid1 = r.id as string;
      const sid2 = (r.subject_id as string | null) ?? null;
      if (subjectIdSet.has(sid1)) coveredSubjectIds.add(sid1);
      if (sid2 && subjectIdSet.has(sid2)) coveredSubjectIds.add(sid2);
    }

    /* ───────── 5) Fallback subjects ───────── */
    const leftoverIds = subjectIds.filter((sid) => !coveredSubjectIds.has(sid));

    const subjectFallbackRows: any[] = [];
    if (leftoverIds.length > 0) {
      const { data, error } = await srv
        .from("subjects")
        .select("id, name")
        .in("id", leftoverIds);

      if (error) {
        console.error("[class.subjects] subjects fallback error", error);
      } else {
        subjectFallbackRows.push(...(data ?? []));
      }
    }

    /* ───────── 6) Réponse ───────── */
    const itemsMap = new Map<string, SubjectItem>();

    // 6a) institution_subjects (prioritaire)
    for (const r of instRows) {
      const id = r.id as string;
      const label =
        (r.custom_name as string) ||
        (r.subjects?.name as string) ||
        "—";

      if (id && !itemsMap.has(id)) {
        itemsMap.set(id, { id, label });
      }
    }

    // 6b) fallback subjects
    for (const r of subjectFallbackRows) {
      const id = r.id as string;
      const label = (r.name as string) || "—";
      if (id && !itemsMap.has(id)) {
        itemsMap.set(id, { id, label });
      }
    }

    const items = Array.from(itemsMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "fr")
    );

    return NextResponse.json({ items });
  } catch (err: any) {
    console.error("[class.subjects] unexpected error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
