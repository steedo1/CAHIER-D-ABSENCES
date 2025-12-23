 // src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubjectItem = {
  id: string;   // id à renvoyer au front (institution_subjects.id si possible, sinon subjects.id)
  label: string;
};

export async function GET(req: NextRequest) {
  try {
    const srv = getSupabaseServiceClient();
    const url = new URL(req.url);

    const class_id = (url.searchParams.get("class_id") ?? "").trim();
    if (!class_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    /* ───────── 1) Classe : établissement + année scolaire ───────── */
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

    if (!institution_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    /* ───────── 2) Récupérer tous les subject_id liés à la classe ───────── */

    const subjectIdSet = new Set<string>();

    // 2a) Matières affectées à la classe (class_teachers)
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

    // 2b) Matières pour lesquelles il y a déjà des notes (grade_flat_marks)
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

    // Si aucune matière liée à la classe → on renvoie vide (et surtout pas toutes les matières de l’établissement)
    if (subjectIdSet.size === 0) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const subjectIds = Array.from(subjectIdSet);

    /* ───────── 3) Retrouver les lignes institution_subjects ─────────
       On gère les deux cas possibles :
       - subjectIds = institution_subjects.id
       - subjectIds = subjects.id (stockés dans class_teachers / grade_flat_marks)
    */

    const instRows: any[] = [];
    const instSeen = new Set<string>();

    // 3a) institution_subjects où id ∈ subjectIds
    if (subjectIds.length > 0) {
      const { data, error } = await srv
        .from("institution_subjects")
        .select("id, subject_id, custom_name, subjects:subject_id(name)")
        .eq("institution_id", institution_id)
        .in("id", subjectIds);

      if (error) {
        console.error(
          "[class.subjects] institution_subjects by id error",
          error
        );
      } else {
        for (const row of data ?? []) {
          const r: any = row;
          if (!instSeen.has(r.id)) {
            instRows.push(r);
            instSeen.add(r.id);
          }
        }
      }
    }

    // 3b) institution_subjects où subject_id ∈ subjectIds
    if (subjectIds.length > 0) {
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
          if (!instSeen.has(r.id)) {
            instRows.push(r);
            instSeen.add(r.id);
          }
        }
      }
    }

    // Ensemble des subjectIds déjà couverts par institution_subjects
    const coveredSubjectIds = new Set<string>();
    for (const r of instRows) {
      const sid1 = r.id as string;
      const sid2 = r.subject_id as string | null;
      if (subjectIdSet.has(sid1)) coveredSubjectIds.add(sid1);
      if (sid2 && subjectIdSet.has(sid2)) coveredSubjectIds.add(sid2);
    }

    /* ───────── 4) Fallback pour les subjectIds non couverts : table subjects ───────── */
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

    /* ───────── 5) Construction de la réponse finale ───────── */

    const itemsMap = new Map<string, SubjectItem>();

    // 5a) À partir de institution_subjects (prioritaire)
    for (const r of instRows) {
      const id = r.id as string;
      const label =
        (r.custom_name as string) ||
        (r.subjects?.name as string) ||
        "—";

      if (!itemsMap.has(id)) {
        itemsMap.set(id, { id, label });
      }
    }

    // 5b) Compléter avec subjects pour les cas où aucun institution_subject n’existe
    for (const r of subjectFallbackRows) {
      const id = r.id as string;
      const label = (r.name as string) || "—";
      if (!itemsMap.has(id)) {
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
