// src/app/api/admin/dashboard/metrics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AcademicYearMeta = {
  code: string;
  label: string;
};

type StudentProfileStatRow = {
  id: string;
  gender: string | null;
  is_affecte: boolean | null;
  is_boarder: boolean | null;
};

type StudentBreakdown = {
  assigned_students: number;
  not_assigned_students: number;
  assignment_unknown: number;
  boarder_students: number;
  not_boarder_students: number;
  boarding_unknown: number;
  boys: number;
  girls: number;
  gender_unknown: number;
};

function computeAcademicYear(d = new Date()): string {
  // Année scolaire ivoirienne : à partir d'août, on bascule sur N-(N+1)
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

async function getCurrentAcademicYear(institutionId: string): Promise<AcademicYearMeta> {
  const srv = getSupabaseServiceClient();

  const { data: current } = await srv
    .from("academic_years")
    .select("code,label,start_date")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current?.code) {
    const code = String((current as any).code);
    return {
      code,
      label: String((current as any).label || code),
    };
  }

  const { data: latest } = await srv
    .from("academic_years")
    .select("code,label,start_date")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.code) {
    const code = String((latest as any).code);
    return {
      code,
      label: String((latest as any).label || code),
    };
  }

  const code = computeAcademicYear();
  return { code, label: code };
}

function uniqStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

// Les filtres PostgREST `.in(...)` sont transportés dans l'URL.
// Avec plusieurs centaines d'UUID, une tranche de 500 produit une URL trop
// longue et Undici/Node remonte seulement `TypeError: fetch failed`.
// 100 UUID restent largement sous les limites usuelles des proxies HTTP.
function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeGender(value: unknown): "boy" | "girl" | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!raw) return null;
  if (["m", "masculin", "male", "garcon", "garcons", "homme", "boy"].includes(raw)) {
    return "boy";
  }
  if (["f", "feminin", "female", "fille", "filles", "femme", "girl"].includes(raw)) {
    return "girl";
  }
  return null;
}

function emptyStudentBreakdown(): StudentBreakdown {
  return {
    assigned_students: 0,
    not_assigned_students: 0,
    assignment_unknown: 0,
    boarder_students: 0,
    not_boarder_students: 0,
    boarding_unknown: 0,
    boys: 0,
    girls: 0,
    gender_unknown: 0,
  };
}

function buildStudentBreakdown(rows: StudentProfileStatRow[]): StudentBreakdown {
  const stats = emptyStudentBreakdown();

  for (const row of rows) {
    if (row.is_affecte === true) stats.assigned_students += 1;
    else if (row.is_affecte === false) stats.not_assigned_students += 1;
    else stats.assignment_unknown += 1;

    if (row.is_boarder === true) stats.boarder_students += 1;
    else if (row.is_boarder === false) stats.not_boarder_students += 1;
    else stats.boarding_unknown += 1;

    const gender = normalizeGender(row.gender);
    if (gender === "boy") stats.boys += 1;
    else if (gender === "girl") stats.girls += 1;
    else stats.gender_unknown += 1;
  }

  return stats;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  // L'identité vient de la session utilisateur vérifiée ci-dessus.
  // La lecture du profil passe ensuite par le client serveur afin d'éviter
  // qu'un problème de transport/RLS du client de session bloque le dashboard.
  const { data: me, error: meErr } = await srv
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json(
      { ok: false, error: meErr.message, stage: "profiles.service" },
      { status: 400 },
    );
  }

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) {
    return NextResponse.json({ ok: false, error: "NO_INSTITUTION" }, { status: 400 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") || "30");
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const academicYear = await getCurrentAcademicYear(institution_id);

  // ─────────────────────────────────────────────────────────────
  // Année scolaire courante : toutes les métriques de scolarité
  // doivent partir des classes de l'année active.
  // ─────────────────────────────────────────────────────────────
  const { data: classRows, error: classesErr } = await srv
    .from("classes")
    .select("id")
    .eq("institution_id", institution_id)
    .eq("academic_year", academicYear.code)
    .limit(10000);

  if (classesErr) {
    return NextResponse.json(
      { ok: false, error: classesErr.message, stage: "classes" },
      { status: 400 },
    );
  }

  const classIds = uniqStrings((classRows ?? []).map((row: any) => row.id));

  // Élèves de l'année courante : inscrits dans les classes de l'année active.
  const studentIdsAll = new Set<string>();
  const studentIdsActive = new Set<string>();

  if (classIds.length > 0) {
    for (const part of chunks(classIds)) {
      const { data: enrollRows, error: enrollErr } = await srv
        .from("class_enrollments")
        .select("student_id,end_date")
        .in("class_id", part)
        .limit(10000);

      if (enrollErr) {
        return NextResponse.json(
          { ok: false, error: enrollErr.message, stage: "class_enrollments" },
          { status: 400 },
        );
      }

      for (const row of enrollRows ?? []) {
        const studentId = String((row as any).student_id || "").trim();
        if (!studentId) continue;
        studentIdsAll.add(studentId);
        if (!(row as any).end_date) studentIdsActive.add(studentId);
      }
    }
  }

  // Détails financiers/sociaux des élèves actifs : affecté, interne, sexe.
  const studentProfileRows: StudentProfileStatRow[] = [];
  const activeStudentIds = Array.from(studentIdsActive);

  if (activeStudentIds.length > 0) {
    for (const part of chunks(activeStudentIds)) {
      const { data: studentRows, error: studentErr } = await srv
        .from("students")
        .select("id,gender,is_affecte,is_boarder")
        .eq("institution_id", institution_id)
        .in("id", part)
        .limit(10000);

      if (studentErr) {
        return NextResponse.json(
          { ok: false, error: studentErr.message, stage: "students" },
          { status: 400 },
        );
      }

      for (const row of studentRows ?? []) {
        studentProfileRows.push({
          id: String((row as any).id || ""),
          gender: ((row as any).gender ?? null) as string | null,
          is_affecte:
            typeof (row as any).is_affecte === "boolean" ? ((row as any).is_affecte as boolean) : null,
          is_boarder:
            typeof (row as any).is_boarder === "boolean" ? ((row as any).is_boarder as boolean) : null,
        });
      }
    }
  }

  const studentBreakdown = buildStudentBreakdown(studentProfileRows);

  // Vivier enseignant actif : indépendant de l'année scolaire.
  // Les affectations classes/matières restent annuelles et ne sont pas recopiées
  // automatiquement lors d'une nouvelle rentrée.
  const { data: teacherRoleRows, error: teacherRolesErr } = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institution_id)
    .eq("role", "teacher")
    .limit(10000);

  if (teacherRolesErr) {
    return NextResponse.json(
      { ok: false, error: teacherRolesErr.message, stage: "teacher_pool" },
      { status: 400 },
    );
  }

  const teacherIds = new Set(
    uniqStrings((teacherRoleRows ?? []).map((row: any) => row.profile_id)),
  );

  // Parents de l'année courante : parents liés aux élèves inscrits dans les classes de l'année active.
  const parentIds = new Set<string>();
  const studentIdsForParents = Array.from(studentIdsAll);
  if (studentIdsForParents.length > 0) {
    for (const part of chunks(studentIdsForParents)) {
      const { data: guardianRows, error: guardianErr } = await srv
        .from("student_guardians")
        .select("parent_id")
        .in("student_id", part)
        .limit(10000);

      if (guardianErr) {
        return NextResponse.json(
          { ok: false, error: guardianErr.message, stage: "student_guardians" },
          { status: 400 },
        );
      }

      for (const row of guardianRows ?? []) {
        const parentId = String((row as any).parent_id || "").trim();
        if (parentId) parentIds.add(parentId);
      }
    }
  }

  async function countMarks(status: "absent" | "late") {
    if (classIds.length === 0) return 0;

    let total = 0;
    for (const part of chunks(classIds)) {
      const { count, error } = await srv
        .from("v_mark_minutes")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", institution_id)
        .eq("status", status)
        .gte("started_at", since)
        .in("class_id", part);

      if (error) throw error;
      total += count ?? 0;
    }
    return total;
  }

  try {
    const [absences, retards] = await Promise.all([countMarks("absent"), countMarks("late")]);

    return NextResponse.json({
      ok: true,
      counts: {
        classes: classIds.length,
        teachers: teacherIds.size,
        parents: parentIds.size,
        students: studentIdsActive.size,
        students_total: studentIdsAll.size,
        ...studentBreakdown,
      },
      kpis: {
        absences,
        retards,
      },
      meta: {
        days,
        academic_year: academicYear.code,
        academic_year_label: academicYear.label,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "DASHBOARD_METRICS_ERROR",
        stage: "v_mark_minutes",
        cause: error?.cause?.message || error?.cause?.code || null,
      },
      { status: 400 },
    );
  }
}
