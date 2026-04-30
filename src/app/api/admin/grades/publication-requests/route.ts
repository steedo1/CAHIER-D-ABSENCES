// src/app/api/admin/grades/publication-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  publishEvaluationOfficially,
  requestChangesForEvaluation,
} from "@/lib/grades/publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string;

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale" | string;

type EvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at: string | null;
  publication_status: PublicationStatus | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_comment: string | null;
  publication_version: number | null;
};

type ClassRow = {
  id: string;
  label: string | null;
  code?: string | null;
  level?: string | null;
  institution_id: string | null;
};

type SubjectRow = {
  id: string;
  name?: string | null;
  label?: string | null;
  title?: string | null;
};

type ProfileRow = {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type StudentRow = {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  matricule?: string | null;
};

type TeacherAssignmentRow = {
  class_id: string;
  subject_id: string | null;
  teacher_id: string | null;
};

type ScoreSource = "student_grades" | "grade_published_scores";

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
  comment?: string | null;
  _source?: ScoreSource;
};

type EvaluationStats = {
  student_count: number;
  graded_count: number;
  missing_count: number;
  average_score: number | null;
  above_average_count: number;
  below_average_count: number;
  highest_score: number | null;
  lowest_score: number | null;
  success_rate: number | null;
  pass_mark: number;
  score_source: ScoreSource;
};

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStatus(value: unknown): PublicationStatus {
  const v = cleanText(value);
  return v || "draft";
}

function isAdminRole(role: string) {
  return role === "super_admin" || role === "admin" || role === "educator";
}

function pickSubjectName(
  row?: SubjectRow | null,
  fallback = "Matière non renseignée"
) {
  return (
    cleanText(row?.name) ||
    cleanText(row?.label) ||
    cleanText(row?.title) ||
    fallback
  );
}

function pickProfileName(
  row?: ProfileRow | null,
  fallback = "Utilisateur non renseigné"
) {
  const explicit = cleanText(row?.full_name) || cleanText(row?.display_name);
  if (explicit) return explicit;

  const combined = [row?.first_name, row?.last_name]
    .map((x) => cleanText(x))
    .filter(Boolean)
    .join(" ");

  return combined || cleanText(row?.email) || fallback;
}

function pickStudentName(row?: StudentRow | null) {
  const explicit = cleanText(row?.full_name) || cleanText(row?.display_name);
  if (explicit) return explicit;

  const combined = [row?.first_name, row?.last_name]
    .map((x) => cleanText(x))
    .filter(Boolean)
    .join(" ");

  return combined || "Élève";
}

function toFiniteNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function scoreSourceForEvaluation(ev: EvaluationRow): ScoreSource {
  return ev.is_published === true ||
    normalizeStatus(ev.publication_status) === "published"
    ? "grade_published_scores"
    : "student_grades";
}

function teacherKey(classId: unknown, subjectId: unknown) {
  const cId = cleanText(classId);
  const sId = cleanText(subjectId);
  return cId && sId ? `${cId}::${sId}` : "";
}

function computeEvaluationStats(params: {
  scores: ScoreRow[];
  scale: number;
  studentCount: number;
  source: ScoreSource;
}): EvaluationStats {
  const { scores, scale, studentCount, source } = params;

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 20;
  const passMark = safeScale / 2;

  const validScores = scores
    .map((row) => {
      const n =
        row.score === null || row.score === undefined ? NaN : Number(row.score);
      return Number.isFinite(n) ? n : null;
    })
    .filter((n): n is number => n !== null);

  const gradedCount = validScores.length;
  const missingCount = Math.max(0, studentCount - gradedCount);

  if (gradedCount === 0) {
    return {
      student_count: studentCount,
      graded_count: 0,
      missing_count: missingCount,
      average_score: null,
      above_average_count: 0,
      below_average_count: 0,
      highest_score: null,
      lowest_score: null,
      success_rate: null,
      pass_mark: round2(passMark),
      score_source: source,
    };
  }

  const sum = validScores.reduce((acc, n) => acc + n, 0);
  const average = sum / gradedCount;
  const aboveAverage = validScores.filter((n) => n >= passMark).length;
  const belowAverage = validScores.filter((n) => n < passMark).length;
  const highest = Math.max(...validScores);
  const lowest = Math.min(...validScores);
  const successRate = (aboveAverage / gradedCount) * 100;

  return {
    student_count: studentCount,
    graded_count: gradedCount,
    missing_count: missingCount,
    average_score: round2(average),
    above_average_count: aboveAverage,
    below_average_count: belowAverage,
    highest_score: round2(highest),
    lowest_score: round2(lowest),
    success_rate: round2(successRate),
    pass_mark: round2(passMark),
    score_source: source,
  };
}

async function getAdminContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHENTICATED",
    };
  }

  const srv = getSupabaseServiceClient();

  const { data: profile, error: profileErr } = await srv
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    console.error(
      "[admin/grades/publication-requests] profile error",
      profileErr
    );

    return {
      ok: false as const,
      status: 403,
      error: "PROFILE_OR_INSTITUTION_NOT_FOUND",
    };
  }

  const profileRow = profile as unknown as {
    id: string;
    institution_id: string | null;
  };

  if (!profileRow.id || !profileRow.institution_id) {
    return {
      ok: false as const,
      status: 403,
      error: "PROFILE_OR_INSTITUTION_NOT_FOUND",
    };
  }

  const { data: roles, error: rolesErr } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileRow.id)
    .eq("institution_id", profileRow.institution_id);

  if (rolesErr) {
    console.error("[admin/grades/publication-requests] roles error", rolesErr);

    return {
      ok: false as const,
      status: 403,
      error: "ROLES_LOAD_FAILED",
    };
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => String(r.role)));
  const allowed = Array.from(roleSet).some(isAdminRole);

  if (!allowed) {
    return {
      ok: false as const,
      status: 403,
      error: "FORBIDDEN",
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id,
    profileId: String(profileRow.id),
    institutionId: String(profileRow.institution_id),
    roles: roleSet,
  };
}

async function fetchClassMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classIds?: string[]
) {
  let q = srv
    .from("classes")
    .select("id,label,code,level,institution_id")
    .eq("institution_id", institutionId);

  const ids = Array.from(new Set((classIds || []).filter(Boolean)));

  if (ids.length) {
    q = q.in("id", ids);
  }

  const { data, error } = await q;

  if (error) {
    console.error(
      "[admin/grades/publication-requests] classes fetch error",
      error
    );
    throw new Error("CLASSES_FETCH_FAILED");
  }

  const map = new Map<string, ClassRow>();

  for (const row of data ?? []) {
    map.set(String((row as any).id), {
      id: String((row as any).id),
      label: (row as any).label ?? null,
      code: (row as any).code ?? null,
      level: (row as any).level ?? null,
      institution_id: (row as any).institution_id ?? null,
    });
  }

  return map;
}

async function fetchSubjectMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  subjectIds: string[]
) {
  const ids = Array.from(new Set(subjectIds.filter(Boolean)));
  const map = new Map<string, SubjectRow>();

  if (!ids.length) return map;

  const resolvedIds = new Set<string>();

  // Important : dans certaines anciennes données, grade_evaluations.subject_id peut
  // contenir soit subjects.id, soit institution_subjects.id. On résout donc les deux.
  try {
    const instById = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects(name)")
      .in("id", ids)
      .eq("institution_id", institutionId);

    if (!instById.error && Array.isArray(instById.data)) {
      for (const row of instById.data) {
        const anyRow = row as any;
        const subjectName =
          cleanText(anyRow.custom_name) ||
          cleanText(anyRow.subjects?.name) ||
          "Matière non renseignée";

        if (anyRow.id) {
          map.set(String(anyRow.id), {
            id: String(anyRow.id),
            name: subjectName,
          });
          resolvedIds.add(String(anyRow.id));
        }

        if (anyRow.subject_id) {
          map.set(String(anyRow.subject_id), {
            id: String(anyRow.subject_id),
            name: subjectName,
          });
          resolvedIds.add(String(anyRow.subject_id));
        }
      }
    } else if (instById.error) {
      console.warn(
        "[admin/grades/publication-requests] institution_subjects by id warning",
        {
          error: instById.error.message,
          details: instById.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] institution_subjects by id exception",
      String(e?.message || e)
    );
  }

  try {
    const instBySubject = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects(name)")
      .in("subject_id", ids)
      .eq("institution_id", institutionId);

    if (!instBySubject.error && Array.isArray(instBySubject.data)) {
      for (const row of instBySubject.data) {
        const anyRow = row as any;
        const subjectName =
          cleanText(anyRow.custom_name) ||
          cleanText(anyRow.subjects?.name) ||
          "Matière non renseignée";

        if (anyRow.id) {
          map.set(String(anyRow.id), {
            id: String(anyRow.id),
            name: subjectName,
          });
          resolvedIds.add(String(anyRow.id));
        }

        if (anyRow.subject_id) {
          map.set(String(anyRow.subject_id), {
            id: String(anyRow.subject_id),
            name: subjectName,
          });
          resolvedIds.add(String(anyRow.subject_id));
        }
      }
    } else if (instBySubject.error) {
      console.warn(
        "[admin/grades/publication-requests] institution_subjects by subject_id warning",
        {
          error: instBySubject.error.message,
          details: instBySubject.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] institution_subjects by subject_id exception",
      String(e?.message || e)
    );
  }

  const leftoverIds = ids.filter((id) => !resolvedIds.has(id));

  if (leftoverIds.length) {
    const { data, error } = await srv
      .from("subjects")
      .select("id,name,label,title")
      .in("id", leftoverIds);

    if (error) {
      console.warn(
        "[admin/grades/publication-requests] subjects fetch warning",
        error
      );
      return map;
    }

    for (const row of data ?? []) {
      map.set(String((row as any).id), {
        id: String((row as any).id),
        name: (row as any).name ?? null,
        label: (row as any).label ?? null,
        title: (row as any).title ?? null,
      });
    }
  }

  return map;
}

async function fetchProfileMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileIds: string[]
) {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  const map = new Map<string, ProfileRow>();

  if (!ids.length) return map;

  // Ne pas sélectionner full_name / first_name / last_name ici : selon ta base,
  // ces colonnes peuvent ne pas exister. display_name est la source fiable.
  const primary = await srv
    .from("profiles")
    .select("id,display_name,email")
    .in("id", ids);

  if (!primary.error) {
    for (const row of primary.data ?? []) {
      map.set(String((row as any).id), row as unknown as ProfileRow);
    }

    return map;
  }

  console.warn("[admin/grades/publication-requests] profiles fetch warning", {
    error: primary.error?.message,
    details: primary.error,
  });

  const fallback = await srv.from("profiles").select("id,email").in("id", ids);

  if (!fallback.error) {
    for (const row of fallback.data ?? []) {
      map.set(String((row as any).id), row as unknown as ProfileRow);
    }
  }

  return map;
}

async function fetchStudentMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  studentIds: string[]
) {
  const ids = Array.from(new Set(studentIds.filter(Boolean)));
  const map = new Map<string, StudentRow>();

  if (!ids.length) return map;

  const broad = await srv
    .from("students")
    .select("id,full_name,display_name,first_name,last_name,matricule")
    .in("id", ids);

  if (!broad.error) {
    for (const row of broad.data ?? []) {
      map.set(String((row as any).id), row as unknown as StudentRow);
    }

    return map;
  }

  const narrow = await srv.from("students").select("id,matricule").in("id", ids);

  if (!narrow.error) {
    for (const row of narrow.data ?? []) {
      map.set(String((row as any).id), row as unknown as StudentRow);
    }
  }

  return map;
}

function addTeacherAssignmentToMap(
  map: Map<string, string>,
  row: TeacherAssignmentRow,
  overwrite = false
) {
  const key = teacherKey(row.class_id, row.subject_id);
  const teacherId = cleanText(row.teacher_id);

  if (!key || !teacherId) return;
  if (!overwrite && map.has(key)) return;

  map.set(key, teacherId);
}

async function fetchTeacherAssignmentMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  evaluations: EvaluationRow[]
) {
  const classIds = Array.from(
    new Set(evaluations.map((ev) => cleanText(ev.class_id)).filter(Boolean))
  );

  const subjectIds = Array.from(
    new Set(evaluations.map((ev) => cleanText(ev.subject_id)).filter(Boolean))
  );

  const byClassSubject = new Map<string, string>();
  const byEvaluation = new Map<string, string>();

  if (!classIds.length || !subjectIds.length) {
    return byEvaluation;
  }

  // 1) Source la plus directe pour l’affectation active : class_teachers.
  try {
    const active = await srv
      .from("class_teachers")
      .select("class_id,subject_id,teacher_id")
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .in("subject_id", subjectIds)
      .is("end_date", null);

    if (!active.error && Array.isArray(active.data)) {
      for (const row of active.data) {
        addTeacherAssignmentToMap(
          byClassSubject,
          row as unknown as TeacherAssignmentRow
        );
      }
    } else if (active.error) {
      console.warn(
        "[admin/grades/publication-requests] class_teachers active fetch warning",
        {
          error: active.error.message,
          details: active.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] class_teachers active exception",
      String(e?.message || e)
    );
  }

  // 2) Fallback class_teachers sans filtre end_date, pour les anciennes données.
  try {
    const allClassTeachers = await srv
      .from("class_teachers")
      .select("class_id,subject_id,teacher_id")
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .in("subject_id", subjectIds);

    if (!allClassTeachers.error && Array.isArray(allClassTeachers.data)) {
      for (const row of allClassTeachers.data) {
        addTeacherAssignmentToMap(
          byClassSubject,
          row as unknown as TeacherAssignmentRow
        );
      }
    } else if (allClassTeachers.error) {
      console.warn(
        "[admin/grades/publication-requests] class_teachers fallback fetch warning",
        {
          error: allClassTeachers.error.message,
          details: allClassTeachers.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] class_teachers fallback exception",
      String(e?.message || e)
    );
  }

  // 3) Fallback emploi du temps / affectations pédagogiques : teacher_subjects.
  try {
    const teacherSubjects = await srv
      .from("teacher_subjects")
      .select("class_id,subject_id,teacher_id")
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .in("subject_id", subjectIds);

    if (!teacherSubjects.error && Array.isArray(teacherSubjects.data)) {
      for (const row of teacherSubjects.data) {
        addTeacherAssignmentToMap(
          byClassSubject,
          row as unknown as TeacherAssignmentRow
        );
      }
    } else if (teacherSubjects.error) {
      console.warn(
        "[admin/grades/publication-requests] teacher_subjects fetch warning",
        {
          error: teacherSubjects.error.message,
          details: teacherSubjects.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] teacher_subjects exception",
      String(e?.message || e)
    );
  }

  for (const ev of evaluations) {
    const key = teacherKey(ev.class_id, ev.subject_id);
    const teacherId = key ? byClassSubject.get(key) : null;

    if (teacherId) {
      byEvaluation.set(ev.id, teacherId);
    }
  }

  return byEvaluation;
}

function addRosterRowToMap(
  map: Map<string, Set<string>>,
  classId: unknown,
  studentId: unknown
) {
  const cId = String(classId || "").trim();
  const sId = String(studentId || "").trim();

  if (!cId || !sId) return;

  if (!map.has(cId)) {
    map.set(cId, new Set<string>());
  }

  map.get(cId)?.add(sId);
}

/**
 * Roster robuste pour les demandes admin.
 *
 * Important :
 * - On essaie d’abord class_enrollments, car c’est le roster réel des classes.
 * - On garde class_students en fallback pour ne rien casser si une ancienne base l’utilise encore.
 * - Les élèves sans note restent dans le roster : ils seront affichés comme NC / Non saisie.
 */
async function fetchRosterMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classIds: string[]
) {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  const map = new Map<string, Set<string>>();

  if (!uniqueClassIds.length) return map;

  // 1) Source principale : class_enrollments actifs
  try {
    const active = await srv
      .from("class_enrollments")
      .select("class_id,student_id")
      .in("class_id", uniqueClassIds)
      .is("end_date", null);

    if (!active.error && Array.isArray(active.data) && active.data.length > 0) {
      for (const row of active.data) {
        addRosterRowToMap(map, (row as any).class_id, (row as any).student_id);
      }

      return map;
    }

    if (active.error) {
      console.warn(
        "[admin/grades/publication-requests] class_enrollments active fetch warning",
        {
          error: active.error.message,
          details: active.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] class_enrollments active exception",
      String(e?.message || e)
    );
  }

  // 2) Fallback class_enrollments sans end_date
  try {
    const allEnrollments = await srv
      .from("class_enrollments")
      .select("class_id,student_id")
      .in("class_id", uniqueClassIds);

    if (
      !allEnrollments.error &&
      Array.isArray(allEnrollments.data) &&
      allEnrollments.data.length > 0
    ) {
      for (const row of allEnrollments.data) {
        addRosterRowToMap(map, (row as any).class_id, (row as any).student_id);
      }

      return map;
    }

    if (allEnrollments.error) {
      console.warn(
        "[admin/grades/publication-requests] class_enrollments fallback fetch warning",
        {
          error: allEnrollments.error.message,
          details: allEnrollments.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] class_enrollments fallback exception",
      String(e?.message || e)
    );
  }

  // 3) Ancien fallback : class_students
  try {
    const legacy = await srv
      .from("class_students")
      .select("class_id,student_id")
      .in("class_id", uniqueClassIds);

    if (!legacy.error && Array.isArray(legacy.data)) {
      for (const row of legacy.data) {
        addRosterRowToMap(map, (row as any).class_id, (row as any).student_id);
      }
    }

    if (legacy.error) {
      console.warn(
        "[admin/grades/publication-requests] class_students fallback fetch warning",
        {
          error: legacy.error.message,
          details: legacy.error,
        }
      );
    }
  } catch (e: any) {
    console.warn(
      "[admin/grades/publication-requests] class_students fallback exception",
      String(e?.message || e)
    );
  }

  return map;
}

async function fetchRosterStudentIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  fallbackIds: string[]
) {
  const rosterMap = await fetchRosterMap(srv, [classId]);
  const rosterSet = rosterMap.get(classId);

  if (rosterSet && rosterSet.size > 0) {
    return Array.from(rosterSet);
  }

  return Array.from(new Set(fallbackIds.filter(Boolean)));
}

function mapScoreRows(
  rows: any[] | null | undefined,
  source: ScoreSource,
  withComment = false
): ScoreRow[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      evaluation_id: String(row?.evaluation_id || ""),
      student_id: String(row?.student_id || ""),
      score:
        row?.score === null || row?.score === undefined
          ? null
          : Number(row.score),
      comment: withComment ? row?.comment ?? null : null,
      _source: source,
    }))
    .filter((row) => row.evaluation_id && row.student_id);
}

function groupScoreRowsByEvaluation(rows: ScoreRow[]) {
  const map = new Map<string, ScoreRow[]>();

  for (const row of rows) {
    if (!map.has(row.evaluation_id)) {
      map.set(row.evaluation_id, []);
    }

    map.get(row.evaluation_id)?.push(row);
  }

  return map;
}

async function fetchStudentGradeRows(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evaluationIds: string[]
): Promise<ScoreRow[]> {
  if (!evaluationIds.length) return [];

  const withComment = await srv
    .from("student_grades")
    .select("evaluation_id,student_id,score,comment")
    .in("evaluation_id", evaluationIds);

  if (!withComment.error && Array.isArray(withComment.data)) {
    return mapScoreRows(withComment.data, "student_grades", true);
  }

  console.warn(
    "[admin/grades/publication-requests] student_grades with comment failed",
    {
      error: withComment.error?.message,
      details: withComment.error,
    }
  );

  const minimal = await srv
    .from("student_grades")
    .select("evaluation_id,student_id,score")
    .in("evaluation_id", evaluationIds);

  if (!minimal.error && Array.isArray(minimal.data)) {
    return mapScoreRows(minimal.data, "student_grades", false);
  }

  console.error(
    "[admin/grades/publication-requests] student_grades minimal failed",
    {
      error: minimal.error?.message,
      details: minimal.error,
    }
  );

  return [];
}

async function fetchOfficialScoreRows(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evaluationIds: string[]
): Promise<ScoreRow[]> {
  if (!evaluationIds.length) return [];

  const res = await srv
    .from("grade_published_scores")
    .select("evaluation_id,student_id,score")
    .in("evaluation_id", evaluationIds)
    .eq("is_current", true);

  if (!res.error && Array.isArray(res.data)) {
    return mapScoreRows(res.data, "grade_published_scores", false);
  }

  console.error("[admin/grades/publication-requests] grade_published_scores failed", {
    error: res.error?.message,
    details: res.error,
  });

  return [];
}

async function fetchScoreRowsByEvaluation(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evaluations: EvaluationRow[]
) {
  const byEval = new Map<string, ScoreRow[]>();

  for (const ev of evaluations) {
    byEval.set(ev.id, []);
  }

  const evaluationIds = Array.from(
    new Set(evaluations.map((ev) => ev.id).filter(Boolean))
  );

  if (!evaluationIds.length) return byEval;

  const [workingRows, officialRows] = await Promise.all([
    fetchStudentGradeRows(srv, evaluationIds),
    fetchOfficialScoreRows(srv, evaluationIds),
  ]);

  const workingByEval = groupScoreRowsByEvaluation(workingRows);
  const officialByEval = groupScoreRowsByEvaluation(officialRows);

  for (const ev of evaluations) {
    const preferredSource = scoreSourceForEvaluation(ev);

    const working = workingByEval.get(ev.id) ?? [];
    const official = officialByEval.get(ev.id) ?? [];

    let selectedRows: ScoreRow[];

    if (preferredSource === "grade_published_scores") {
      selectedRows = official.length > 0 ? official : working;
    } else {
      selectedRows = working.length > 0 ? working : official;
    }

    byEval.set(ev.id, selectedRows);

    if (selectedRows.length === 0) {
      console.warn("[admin/grades/publication-requests] no scores found", {
        evaluation_id: ev.id,
        publication_status: ev.publication_status,
        is_published: ev.is_published,
        preferredSource,
        workingCount: working.length,
        officialCount: official.length,
      });
    }
  }

  return byEval;
}

async function loadEvaluationOrFail(params: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  evaluationId: string;
  institutionId: string;
}) {
  const { srv, evaluationId, institutionId } = params;

  const { data: ev, error } = await srv
    .from("grade_evaluations")
    .select(
      [
        "id",
        "class_id",
        "subject_id",
        "subject_component_id",
        "teacher_id",
        "eval_date",
        "eval_kind",
        "scale",
        "coeff",
        "is_published",
        "published_at",
        "publication_status",
        "submitted_at",
        "submitted_by",
        "reviewed_at",
        "reviewed_by",
        "review_comment",
        "publication_version",
      ].join(",")
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (error || !ev) {
    return {
      ok: false as const,
      status: 404,
      error: "EVALUATION_NOT_FOUND",
    };
  }

  const evAny = ev as any;

  const classMap = await fetchClassMap(srv, institutionId, [
    String(evAny.class_id),
  ]);

  const classRow = classMap.get(String(evAny.class_id));

  if (!classRow || classRow.institution_id !== institutionId) {
    return {
      ok: false as const,
      status: 403,
      error: "FORBIDDEN",
    };
  }

  const evaluation = ev as unknown as EvaluationRow;

  return {
    ok: true as const,
    evaluation,
    classRow,
  };
}

async function buildRequestItems(params: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  evaluations: EvaluationRow[];
}) {
  const { srv, institutionId, evaluations } = params;

  const classIds = evaluations.map((ev) => ev.class_id).filter(Boolean);

  const subjectIds = evaluations
    .map((ev) => ev.subject_id)
    .filter((x): x is string => !!x);

  const [classMap, subjectMap, rosterMap, scoresByEval, teacherAssignmentMap] =
    await Promise.all([
      fetchClassMap(srv, institutionId, classIds),
      fetchSubjectMap(srv, institutionId, subjectIds),
      fetchRosterMap(srv, classIds),
      fetchScoreRowsByEvaluation(srv, evaluations),
      fetchTeacherAssignmentMap(srv, institutionId, evaluations),
    ]);

  const profileIds = evaluations
    .flatMap((ev) => [
      ev.teacher_id,
      teacherAssignmentMap.get(ev.id),
      ev.submitted_by,
      ev.reviewed_by,
    ])
    .filter((x): x is string => !!x);

  const profileMap = await fetchProfileMap(srv, profileIds);

  return evaluations.map((ev) => {
    const cls = classMap.get(ev.class_id);
    const subject = ev.subject_id ? subjectMap.get(ev.subject_id) : null;

    const fallbackTeacherId = teacherAssignmentMap.get(ev.id) ?? null;
    const directTeacher = ev.teacher_id ? profileMap.get(ev.teacher_id) : null;
    const fallbackTeacher = fallbackTeacherId
      ? profileMap.get(fallbackTeacherId)
      : null;

    const submittedBy = ev.submitted_by ? profileMap.get(ev.submitted_by) : null;
    const reviewedBy = ev.reviewed_by ? profileMap.get(ev.reviewed_by) : null;

    const directTeacherName = directTeacher
      ? pickProfileName(directTeacher, "")
      : "";
    const fallbackTeacherName = fallbackTeacher
      ? pickProfileName(fallbackTeacher, "")
      : "";

    const teacherName =
      directTeacherName || fallbackTeacherName || "Enseignant non renseigné";
    const resolvedTeacherId = ev.teacher_id || fallbackTeacherId || null;

    const scoreRows = scoresByEval.get(ev.id) ?? [];
    const rosterSet = rosterMap.get(ev.class_id);

    const fallbackStudentCount = new Set(
      scoreRows.map((row) => row.student_id).filter(Boolean)
    ).size;

    const studentCount = rosterSet?.size || fallbackStudentCount;
    const source = scoreRows[0]?._source ?? scoreSourceForEvaluation(ev);

    const stats = computeEvaluationStats({
      scores: scoreRows,
      scale: toFiniteNumber(ev.scale, 20),
      studentCount,
      source,
    });

    return {
      id: ev.id,
      evaluation_id: ev.id,
      class_id: ev.class_id,
      class_label: cleanText(cls?.label) || cleanText(cls?.code) || "Classe",
      class_level: cls?.level ?? null,

      subject_id: ev.subject_id,
      subject_name: ev.subject_id
        ? pickSubjectName(subject)
        : "Matière non renseignée",

      subject_component_id: ev.subject_component_id,
      teacher_id: resolvedTeacherId,
      teacher_name: teacherName,

      eval_date: ev.eval_date,
      eval_kind: ev.eval_kind,
      scale: toFiniteNumber(ev.scale, 20),
      coeff: toFiniteNumber(ev.coeff, 1),

      is_published: ev.is_published === true,
      published_at: ev.published_at ?? null,
      publication_status: normalizeStatus(ev.publication_status),
      publication_version: toFiniteNumber(ev.publication_version, 0),

      submitted_at: ev.submitted_at ?? null,
      submitted_by: ev.submitted_by ?? null,
      submitted_by_name: submittedBy
        ? pickProfileName(submittedBy, "Utilisateur non renseigné")
        : null,

      reviewed_at: ev.reviewed_at ?? null,
      reviewed_by: ev.reviewed_by ?? null,
      reviewed_by_name: reviewedBy
        ? pickProfileName(reviewedBy, "Utilisateur non renseigné")
        : null,
      review_comment: ev.review_comment ?? null,

      scores_count: stats.graded_count,
      students_count: stats.student_count,
      graded_count: stats.graded_count,
      missing_count: stats.missing_count,
      success_count: stats.above_average_count,
      below_average_count: stats.below_average_count,
      stats,
    };
  });
}

async function buildEvaluationDetail(params: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  evaluation: EvaluationRow;
}) {
  const { srv, evaluation } = params;

  const scoresByEval = await fetchScoreRowsByEvaluation(srv, [evaluation]);
  const scoreRows = scoresByEval.get(evaluation.id) ?? [];

  const scoreByStudentId = new Map<string, ScoreRow>();

  for (const row of scoreRows) {
    scoreByStudentId.set(row.student_id, row);
  }

  const rosterIds = await fetchRosterStudentIds(
    srv,
    evaluation.class_id,
    scoreRows.map((row) => row.student_id)
  );

  const studentMap = await fetchStudentMap(srv, rosterIds);

  const students = rosterIds
    .map((studentId) => {
      const student = studentMap.get(studentId);
      const score = scoreByStudentId.get(studentId);

      return {
        student_id: studentId,
        student_name: pickStudentName(student),
        matricule: student?.matricule ?? null,
        score: score?.score ?? null,
        comment: score?.comment ?? null,
        has_score: scoreByStudentId.has(studentId),
        score_status: scoreByStudentId.has(studentId) ? "graded" : "NC",
      };
    })
    .sort((a, b) => {
      const an = cleanText(a.student_name).toLowerCase();
      const bn = cleanText(b.student_name).toLowerCase();
      return an.localeCompare(bn, "fr");
    });

  const source = scoreRows[0]?._source ?? scoreSourceForEvaluation(evaluation);

  const stats = computeEvaluationStats({
    scores: scoreRows,
    scale: toFiniteNumber(evaluation.scale, 20),
    studentCount: rosterIds.length,
    source,
  });

  return {
    students,
    summary: {
      roster_count: stats.student_count,
      scores_count: scoreRows.length,
      filled_scores_count: stats.graded_count,
      missing_scores_count: stats.missing_count,
      average_score: stats.average_score,
      above_average_count: stats.above_average_count,
      below_average_count: stats.below_average_count,
      highest_score: stats.highest_score,
      lowest_score: stats.lowest_score,
      success_rate: stats.success_rate,
      pass_mark: stats.pass_mark,
      score_source: stats.score_source,
    },
  };
}

/* ==========================================
   GET
   - /api/admin/grades/publication-requests
   - /api/admin/grades/publication-requests?status=submitted
   - /api/admin/grades/publication-requests?evaluation_id=...
========================================== */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getAdminContext();

    if (!ctx.ok) return bad(ctx.error, ctx.status);

    const { srv, institutionId } = ctx;
    const { searchParams } = new URL(req.url);

    const evaluationId = cleanText(searchParams.get("evaluation_id"));
    const classId = cleanText(searchParams.get("class_id"));
    const statusRaw = cleanText(searchParams.get("status")) || "submitted";
    const includeScores =
      searchParams.get("include_scores") === "1" || !!evaluationId;

    const limitRaw = Number(searchParams.get("limit") || 100);
    const limit = Math.max(
      1,
      Math.min(300, Number.isFinite(limitRaw) ? limitRaw : 100)
    );

    if (evaluationId) {
      const loaded = await loadEvaluationOrFail({
        srv,
        evaluationId,
        institutionId,
      });

      if (!loaded.ok) return bad(loaded.error, loaded.status);

      const items = await buildRequestItems({
        srv,
        institutionId,
        evaluations: [loaded.evaluation],
      });

      const detail = includeScores
        ? await buildEvaluationDetail({
            srv,
            institutionId,
            evaluation: loaded.evaluation,
          })
        : null;

      return NextResponse.json({
        ok: true,
        item: items[0] ?? null,
        detail,
      });
    }

    const classMap = await fetchClassMap(srv, institutionId);
    const allowedClassIds = Array.from(classMap.keys());

    if (!allowedClassIds.length) {
      return NextResponse.json({
        ok: true,
        items: [],
        meta: {
          count: 0,
          status: statusRaw,
          reason: "NO_CLASSES",
        },
      });
    }

    let q = srv
      .from("grade_evaluations")
      .select(
        [
          "id",
          "class_id",
          "subject_id",
          "subject_component_id",
          "teacher_id",
          "eval_date",
          "eval_kind",
          "scale",
          "coeff",
          "is_published",
          "published_at",
          "publication_status",
          "submitted_at",
          "submitted_by",
          "reviewed_at",
          "reviewed_by",
          "review_comment",
          "publication_version",
        ].join(",")
      )
      .in("class_id", allowedClassIds)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("eval_date", { ascending: false })
      .limit(limit);

    if (classId) {
      if (!classMap.has(classId)) {
        return bad("CLASS_NOT_FOUND_OR_FORBIDDEN", 403);
      }

      q = q.eq("class_id", classId);
    }

    if (statusRaw !== "all") {
      q = q.eq("publication_status", statusRaw);
    }

    const { data, error } = await q;

    if (error) {
      console.error(
        "[admin/grades/publication-requests] GET evaluations error",
        error
      );
      return bad("REQUESTS_FETCH_FAILED", 500, { details: error.message });
    }

    const evaluations = ((data ?? []) as any[]).map(
      (row) => row as unknown as EvaluationRow
    );

    const items = await buildRequestItems({
      srv,
      institutionId,
      evaluations,
    });

    return NextResponse.json({
      ok: true,
      items,
      meta: {
        count: items.length,
        status: statusRaw,
        limit,
      },
    });
  } catch (e: any) {
    console.error("[admin/grades/publication-requests] unexpected GET", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

/* ==========================================
   POST
   Actions :
   - approve / publish / validate
   - request_changes / changes_requested / reject
========================================== */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext();

    if (!ctx.ok) return bad(ctx.error, ctx.status);

    const { srv, institutionId, profileId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      evaluation_id?: string;
      action?: string;
      comment?: string | null;
      queue_push?: boolean;
    };

    const evaluationId = cleanText(body.evaluation_id);
    const action = cleanText(body.action).toLowerCase();
    const comment = cleanText(body.comment);

    if (!evaluationId) return bad("MISSING_EVALUATION_ID", 400);
    if (!action) return bad("MISSING_ACTION", 400);

    const loaded = await loadEvaluationOrFail({
      srv,
      evaluationId,
      institutionId,
    });

    if (!loaded.ok) return bad(loaded.error, loaded.status);

    const status = normalizeStatus(loaded.evaluation.publication_status);

    let result;

    if (["approve", "publish", "validate", "approved"].includes(action)) {
      if (
        status !== "submitted" &&
        status !== "changes_requested" &&
        status !== "draft"
      ) {
        if (status === "published" || loaded.evaluation.is_published === true) {
          return bad("EVALUATION_ALREADY_PUBLISHED", 409, {
            publication_status: status,
          });
        }
      }

      result = await publishEvaluationOfficially({
        evaluationId,
        actorProfileId: profileId,
        comment: comment || null,
        forceNewVersion: false,
        queuePush: body.queue_push !== false,
      });
    } else if (
      ["request_changes", "changes_requested", "reject", "ask_correction"].includes(
        action
      )
    ) {
      if (!comment) {
        return bad("MISSING_REVIEW_COMMENT", 400, {
          message: "Un commentaire est obligatoire pour demander une correction.",
        });
      }

      result = await requestChangesForEvaluation({
        evaluationId,
        actorProfileId: profileId,
        comment,
      });
    } else {
      return bad("UNSUPPORTED_ACTION", 400, {
        supported_actions: ["approve", "request_changes"],
      });
    }

    if (!result.ok) {
      return bad(result.error, result.status ?? 400, {
        details: result.details ?? null,
      });
    }

    const reloaded = await loadEvaluationOrFail({
      srv,
      evaluationId,
      institutionId,
    });

    if (!reloaded.ok) {
      return NextResponse.json({
        ok: true,
        action,
        publication: result,
        item: null,
      });
    }

    const items = await buildRequestItems({
      srv,
      institutionId,
      evaluations: [reloaded.evaluation],
    });

    return NextResponse.json({
      ok: true,
      action,
      publication: result,
      item: items[0] ?? null,
    });
  } catch (e: any) {
    console.error("[admin/grades/publication-requests] unexpected POST", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
