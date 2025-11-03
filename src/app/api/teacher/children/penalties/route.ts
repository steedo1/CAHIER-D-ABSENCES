//src/app/api/teacher/children/penalties/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Map subjectId → subjectName (institution_subjects.custom_name > subjects.name).
 *  On accepte à la fois des ids de subjects et d’institution_subjects en entrée. */
async function buildSubjectNameMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;

  // institution_subjects (filtrage JS)
  const { data: insAll } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subject_id");

  const byInsId = (insAll || []).filter((r: any) => uniq.includes(r.id));
  for (const r of byInsId) if (r.custom_name) out.set(r.id, r.custom_name);

  // subjects pour ids manquants
  const stillMissing = uniq.filter((k) => !out.has(k));
  if (stillMissing.length) {
    const { data: subs } = await srv
      .from("subjects")
      .select("id, name, code, subject_key")
      .in("id", stillMissing);
    for (const s of subs || []) {
      const nm = s.name || s.code || s.subject_key || null;
      if (nm) out.set(s.id, nm);
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  try {
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ items: [] });

    const url = new URL(req.url);
    const student_id = url.searchParams.get("student_id");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    console.log("[children.penalties] input", { student_id, limit });

    if (!student_id) return NextResponse.json({ items: [] });

    // 1) pénalités (on lit aussi les champs auteur ajoutés à l'insert)
    const { data: rows, error } = await srv
      .from("conduct_penalties")
      .select(`
        id,
        occurred_at,
        rubric,
        points,
        reason,
        class_id,
        subject_id,
        author_profile_id,
        author_role_label,
        author_subject_name
      `)
      .eq("student_id", student_id)
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[children.penalties] penalties fetch error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.log("[children.penalties] rows", { count: rows?.length || 0 });
    if (!rows?.length) return NextResponse.json({ items: [] });

    // 2) maps classes / auteurs (sans profiles.role)
    const classIds = Array.from(new Set(rows.map((r) => r.class_id).filter(Boolean))) as string[];
    const subjIds = Array.from(new Set(rows.map((r) => r.subject_id).filter(Boolean))) as string[];
    const authorIds = Array.from(new Set(rows.map((r) => r.author_profile_id).filter(Boolean))) as string[];

    const [clRes, auRes] = await Promise.all([
      classIds.length
        ? srv.from("classes").select("id,label").in("id", classIds)
        : Promise.resolve({ data: [] as any[] }),
      authorIds.length
        ? srv.from("profiles").select("id,display_name").in("id", authorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const classMap = new Map((clRes.data || []).map((c: any) => [c.id, c.label]));
    const authorMap = new Map(
      (auRes.data || []).map((p: any) => [p.id, { name: (p.display_name as string | null) ?? null }])
    );
    console.log("[children.penalties] maps", { class_count: classMap.size, author_count: authorMap.size });

    // 3) noms de matière rattachés à la pénalité (si subject_id rempli)
    const penaltySubjectNameMap = await buildSubjectNameMap(srv, subjIds);

    // 4) fallback matière via class_teachers si on n’a ni author_subject_name ni subject_id
    const needFallback = rows.some((r) => !r.author_subject_name && !r.subject_id && r.class_id && r.author_profile_id);
    let fallbackCT = new Map<string, string>(); // `${class_id}|${teacher_id}` -> subject_name
    if (needFallback && classIds.length && authorIds.length) {
      const nowIso = new Date().toISOString();
      const { data: cts } = await srv
        .from("class_teachers")
        .select("class_id, teacher_id, subject_id")
        .in("class_id", classIds)
        .in("teacher_id", authorIds)
        .lte("start_date", nowIso)
        .or(`end_date.is.null,end_date.gte.${nowIso}`);

      const ctSubjectIds = Array.from(new Set((cts || []).map((r: any) => r.subject_id).filter(Boolean))) as string[];
      const ctSubjectNameMap = await buildSubjectNameMap(srv, ctSubjectIds);

      for (const r of cts || []) {
        const key = `${r.class_id}|${r.teacher_id}`;
        const nm = r.subject_id ? (ctSubjectNameMap.get(r.subject_id) || null) : null;
        if (nm) fallbackCT.set(key, nm);
      }
      console.log("[children.penalties] fallbackCT size", fallbackCT.size);
    }

    // 5) payload final
    const items = rows.map((r) => {
      const a = authorMap.get(r.author_profile_id as string);

      const penaltySubjectName = r.subject_id
        ? penaltySubjectNameMap.get(r.subject_id) || null
        : null;

      // priorité nom matière pour affichage:
      //   1) author_subject_name (stocké à l’insert)
      //   2) penalty subject_name (si subject_id était un vrai subjects.id ou ins-subj.id)
      //   3) fallback via class_teachers
      let authorSubjectName = r.author_subject_name || penaltySubjectName;
      if (!authorSubjectName && r.class_id && r.author_profile_id) {
        const key = `${r.class_id}|${r.author_profile_id}`;
        authorSubjectName = fallbackCT.get(key) || null;
      }

      // rôle affichable:
      const author_role_label = r.author_role_label
        ?? ((authorSubjectName || penaltySubjectName) ? "Enseignant" : "Administration");

      return {
        id: r.id,
        when: r.occurred_at,
        rubric: r.rubric as "discipline" | "tenue" | "moralite",
        points: Number(r.points || 0),
        reason: r.reason || null,
        class_label: classMap.get(r.class_id) || null,

        subject_name: penaltySubjectName,       // info rattachée à la pénalité
        author_subject_name: authorSubjectName, // “prof de …” pour l’affichage

        author_name: a?.name || null,
        author_role_label,
      };
    });

    console.log(
      "[children.penalties] output sample",
      items.slice(0, 3).map((x) => ({
        id: x.id,
        author_role_label: x.author_role_label,
        author_subject_name: x.author_subject_name,
        subject_name: x.subject_name,
      }))
    );

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[children.penalties] fatal", e);
    return NextResponse.json({ error: e?.message || "penalties_fetch_failed" }, { status: 400 });
  }
}

