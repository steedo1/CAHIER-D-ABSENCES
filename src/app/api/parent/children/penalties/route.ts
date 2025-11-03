// src/app/api/parent/children/penalties/route.ts
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
  if (!uniq.length) return out;

  // institution_subjects (filtrage JS)
  const { data: insAll } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subject_id");

  const byInsId = (insAll || []).filter((r: any) => uniq.includes(r.id));
  for (const r of byInsId) if (r.custom_name) out.set(r.id, r.custom_name);

  // subjects pour ids restants
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
    if (!user) return NextResponse.json({ items: [] }, { status: 401 });

    const url = new URL(req.url);
    const student_id = url.searchParams.get("student_id") || "";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const from  = url.searchParams.get("from") || ""; // ISO (optionnel)
    const to    = url.searchParams.get("to")   || ""; // ISO (optionnel)

    if (!student_id) return NextResponse.json({ items: [] });

    // ── CONTRÔLE D’ACCÈS : le parent doit être tuteur de l’élève
    // Table repérée dans tes captures: student_guardians (guardian_profile_id / parent_id)
    const { data: link, error: guardErr } = await srv
      .from("student_guardians")
      .select("id")
      .eq("student_id", student_id)
      .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    if (guardErr) {
      // Soft-fail: on ne divulgue rien
      return NextResponse.json({ items: [] });
    }
    if (!link) {
      // Pas autorisé à voir cet élève
      return NextResponse.json({ items: [] }, { status: 403 });
    }

    // ── 1) Lire les pénalités (même source et champs que côté teacher)
    let q = srv
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

    if (from) q = q.gte("occurred_at", from);
    if (to)   q = q.lte("occurred_at", to);

    const { data: rows, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!rows?.length) return NextResponse.json({ items: [] });

    // ── 2) maps classes / auteurs
    const classIds  = Array.from(new Set(rows.map((r) => r.class_id).filter(Boolean))) as string[];
    const subjIds   = Array.from(new Set(rows.map((r) => r.subject_id).filter(Boolean))) as string[];
    const authorIds = Array.from(new Set(rows.map((r) => r.author_profile_id).filter(Boolean))) as string[];

    const [clRes, auRes] = await Promise.all([
      classIds.length
        ? srv.from("classes").select("id,label").in("id", classIds)
        : Promise.resolve({ data: [] as any[] }),
      authorIds.length
        ? srv.from("profiles").select("id,display_name").in("id", authorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const classMap  = new Map((clRes.data || []).map((c: any) => [c.id, c.label]));
    const authorMap = new Map((auRes.data || []).map((p: any) => [p.id, { name: (p.display_name as string | null) ?? null }]));

    // ── 3) noms de matière rattachés à la pénalité (si subject_id rempli)
    const penaltySubjectNameMap = await buildSubjectNameMap(srv, subjIds);

    // ── 4) fallback matière via class_teachers (même logique que teacher: à "now")
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
    }

    // ── 5) payload final (identique au teacher côté affichage)
    const items = rows.map((r) => {
      const a = authorMap.get(r.author_profile_id as string);

      const penaltySubjectName = r.subject_id
        ? penaltySubjectNameMap.get(r.subject_id) || null
        : null;

      // priorité nom matière:
      //   1) author_subject_name (stocké à l’insert)
      //   2) penalty subject_name (dérivé de subject_id)
      //   3) fallback via class_teachers
      let authorSubjectName = r.author_subject_name || penaltySubjectName;
      if (!authorSubjectName && r.class_id && r.author_profile_id) {
        const key = `${r.class_id}|${r.author_profile_id}`;
        authorSubjectName = fallbackCT.get(key) || null;
      }

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

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "penalties_fetch_failed" }, { status: 400 });
  }
}
