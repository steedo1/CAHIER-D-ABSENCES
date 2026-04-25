import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubjectItem = {
  id: string;
  label: string;
  subject_id?: string | null;
};

function uniq(values: string[]) {
  return Array.from(
    new Set(values.map((v) => String(v || "").trim()).filter(Boolean))
  );
}

async function mapSubjectIdsToItems(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectIds: string[]
): Promise<SubjectItem[]> {
  const subjectIds = uniq(rawSubjectIds);
  if (!subjectIds.length) return [];

  const instRows: any[] = [];
  const seenInstIds = new Set<string>();

  // Cas 1 : les IDs reçus sont des institution_subjects.id
  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !seenInstIds.has(id)) {
        instRows.push(row);
        seenInstIds.add(id);
      }
    }
  }

  // Cas 2 : les IDs reçus sont des subjects.id canoniques
  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("subject_id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !seenInstIds.has(id)) {
        instRows.push(row);
        seenInstIds.add(id);
      }
    }
  }

  const covered = new Set<string>();

  for (const row of instRows) {
    const instId = String((row as any)?.id || "").trim();
    const canonicalId = String((row as any)?.subject_id || "").trim();

    if (instId) covered.add(instId);
    if (canonicalId) covered.add(canonicalId);
  }

  const itemsMap = new Map<string, SubjectItem>();

  for (const row of instRows) {
    const instId = String((row as any)?.id || "").trim();
    const canonicalId = String((row as any)?.subject_id || "").trim();

    const label = String(
      (row as any)?.custom_name ||
        (row as any)?.subjects?.name ||
        "Matière"
    ).trim();

    if (instId && !itemsMap.has(instId)) {
      itemsMap.set(instId, {
        id: instId,
        subject_id: canonicalId || null,
        label: label || "Matière",
      });
    }
  }

  // Dernier fallback : matière globale sans ligne institution_subjects
  const leftovers = subjectIds.filter((id) => !covered.has(id));

  if (leftovers.length) {
    const { data, error } = await srv
      .from("subjects")
      .select("id, name")
      .in("id", leftovers);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      const label = String((row as any)?.name || "Matière").trim();

      if (id && !itemsMap.has(id)) {
        itemsMap.set(id, {
          id,
          subject_id: id,
          label: label || "Matière",
        });
      }
    }
  }

  return Array.from(itemsMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "fr", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
      error: authError,
    } = await supa.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED", items: [] },
        { status: 401 }
      );
    }

    const { data: roleRow, error: roleErr } = await supa
      .from("user_roles")
      .select("institution_id, role")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (
      roleErr ||
      !roleRow ||
      !["super_admin", "admin"].includes(String((roleRow as any).role))
    ) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", items: [] },
        { status: 403 }
      );
    }

    const institutionId = String((roleRow as any).institution_id || "").trim();

    if (!institutionId) {
      return NextResponse.json(
        { ok: false, error: "NO_INSTITUTION", items: [] },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const classId = String(url.searchParams.get("class_id") || "").trim();

    if (!classId) {
      return NextResponse.json({ ok: true, items: [] });
    }

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id, institution_id")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json(
        { ok: false, error: clsErr.message, items: [] },
        { status: 400 }
      );
    }

    if (!cls || String((cls as any).institution_id || "") !== institutionId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN_CLASS", items: [] },
        { status: 403 }
      );
    }

    const subjectIds: string[] = [];

    // 1) Affectations classe/prof/matière
    {
      const { data, error } = await srv
        .from("class_teachers")
        .select("subject_id")
        .eq("class_id", classId);

      if (error) throw error;

      subjectIds.push(
        ...((data || []) as any[])
          .map((row) => String(row?.subject_id || "").trim())
          .filter(Boolean)
      );
    }

    // 2) Emplois du temps, si disponibles
    try {
      const { data, error } = await srv
        .from("teacher_timetables")
        .select("subject_id")
        .eq("institution_id", institutionId)
        .eq("class_id", classId);

      if (!error) {
        subjectIds.push(
          ...((data || []) as any[])
            .map((row) => String(row?.subject_id || "").trim())
            .filter(Boolean)
        );
      }
    } catch {
      // Table optionnelle selon les installations : on ne bloque pas.
    }

    // 3) Évaluations déjà créées
    try {
      const { data, error } = await srv
        .from("grade_evaluations")
        .select("subject_id")
        .eq("class_id", classId);

      if (!error) {
        subjectIds.push(
          ...((data || []) as any[])
            .map((row) => String(row?.subject_id || "").trim())
            .filter(Boolean)
        );
      }
    } catch {
      // Fallback optionnel.
    }

    // 4) Notes déjà saisies
    try {
      const { data, error } = await srv
        .from("grade_flat_marks")
        .select("subject_id")
        .eq("institution_id", institutionId)
        .eq("class_id", classId);

      if (!error) {
        subjectIds.push(
          ...((data || []) as any[])
            .map((row) => String(row?.subject_id || "").trim())
            .filter(Boolean)
        );
      }
    } catch {
      // Fallback optionnel.
    }

    const items = await mapSubjectIdsToItems(srv, institutionId, subjectIds);

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (err: any) {
    console.error("[admin.notes.subjects] unexpected error", err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "ADMIN_NOTES_SUBJECTS_FAILED",
        items: [],
      },
      { status: 500 }
    );
  }
}