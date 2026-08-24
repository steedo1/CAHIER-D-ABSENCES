import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getClassLevelCode,
  normalizeClassEducationType,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleRow = { role?: string | null; institution_id?: string | null };
type AdminContext = {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  userId: string;
  institutionId: string;
};

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  grading_period_id: string | null;
  academic_year: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at: string | null;
  publication_status: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

type ScoreInput = {
  student_id?: string;
  score?: number | null;
};

type ScoreRow = {
  evaluation_id?: string | null;
  student_id?: string | null;
  score?: number | string | null;
};

type RosterItem = {
  id: string;
  full_name: string;
  matricule: string | null;
};

type PeriodRow = {
  id: string;
  institution_id?: string | null;
  academic_year?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  label?: string | null;
  short_label?: string | null;
  code?: string | null;
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return json({ ok: false, error, ...(extra || {}) }, status);
}

function cleanName(...parts: Array<string | null | undefined>) {
  return parts
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function chunks<T>(values: T[], size = 400): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function requireAdmin(): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; response: NextResponse }
> {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, response: bad("UNAUTHENTICATED", 401) };
  }

  const { data: profile, error: profileError } = await srv
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.institution_id) {
    return { ok: false, response: bad("NO_INSTITUTION", 403) };
  }

  const institutionId = String(profile.institution_id);
  const { data: roles, error: rolesError } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (rolesError) {
    return { ok: false, response: bad(rolesError.message, 400) };
  }

  const canManage = ((roles || []) as RoleRow[]).some((row) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;
    if (role !== "admin") return false;
    const roleInstitution = String(row.institution_id || "").trim();
    return !roleInstitution || roleInstitution === institutionId;
  });

  if (!canManage) {
    return { ok: false, response: bad("ADMIN_REQUIRED", 403) };
  }

  return {
    ok: true,
    ctx: { srv, userId: user.id, institutionId },
  };
}

async function ensureClass(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
) {
  const { data, error } = await srv
    .from("classes")
    .select(
      "id,label,level,academic_year,institution_id,education_type,formation_code,formation_level_code",
    )
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function resolveSubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectId: string,
) {
  const raw = String(rawSubjectId || "").trim();
  if (!raw) {
    return { raw: "", globalId: "", ids: [] as string[], label: "Matière" };
  }

  const ids = new Set<string>([raw]);
  let globalId = "";
  let label = "";

  const { data: direct, error: directError } = await srv
    .from("subjects")
    .select("id,name,code")
    .eq("id", raw)
    .maybeSingle();
  if (directError) throw directError;

  if (direct?.id) {
    globalId = String(direct.id);
    label = String(direct.name || direct.code || "");
  } else {
    const { data: inst, error: instError } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name")
      .eq("institution_id", institutionId)
      .eq("id", raw)
      .maybeSingle();
    if (instError) throw instError;

    if (inst?.subject_id) {
      globalId = String(inst.subject_id);
      label = String(inst.custom_name || "");
    }
  }

  if (!globalId) {
    return { raw, globalId: "", ids: Array.from(ids), label: "Matière" };
  }

  ids.add(globalId);

  const [{ data: links, error: linksError }, { data: baseSubject, error: baseError }] =
    await Promise.all([
      srv
        .from("institution_subjects")
        .select("id,subject_id,custom_name")
        .eq("institution_id", institutionId)
        .eq("subject_id", globalId),
      srv.from("subjects").select("id,name,code").eq("id", globalId).maybeSingle(),
    ]);

  if (linksError) throw linksError;
  if (baseError) throw baseError;

  for (const row of links || []) {
    if ((row as any).id) ids.add(String((row as any).id));
    if ((row as any).subject_id) ids.add(String((row as any).subject_id));
    if (!label && (row as any).custom_name) label = String((row as any).custom_name);
  }

  if (!label) {
    label = String((baseSubject as any)?.name || (baseSubject as any)?.code || "Matière");
  }

  return {
    raw,
    globalId,
    ids: Array.from(ids),
    label,
  };
}

async function ensureTeacherAssignment(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
  teacherId: string,
  subjectIds: string[],
) {
  if (!teacherId || !subjectIds.length) return false;

  const { data, error } = await srv
    .from("class_teachers")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .eq("teacher_id", teacherId)
    .in("subject_id", subjectIds)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function ensurePeriod(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  periodId: string,
): Promise<PeriodRow | null> {
  const { data, error } = await srv
    .from("grade_periods")
    .select("id,institution_id,academic_year,start_date,end_date,is_active,label,short_label,code")
    .eq("id", periodId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw error;
  return (data as PeriodRow | null) || null;
}

async function readLocks(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evaluationIds: string[],
) {
  const result = new Map<string, boolean>();
  if (!evaluationIds.length) return result;

  const { data, error } = await srv
    .from("grade_evaluation_locks")
    .select("evaluation_id,is_locked")
    .in("evaluation_id", evaluationIds);

  if (error) {
    const message = String(error.message || "");
    const code = String((error as any).code || "");
    const missingTable = code === "42P01" || message.includes("does not exist");
    if (!missingTable) console.warn("[admin/grades/register] locks", error);
    return result;
  }

  for (const row of data || []) {
    result.set(String((row as any).evaluation_id), (row as any).is_locked === true);
  }
  return result;
}

function isEvaluationEditable(ev: EvaluationRow, locked: boolean) {
  const status = String(ev.publication_status || "draft").toLowerCase();
  return (
    !locked &&
    ev.is_published !== true &&
    status !== "published" &&
    status !== "submitted"
  );
}

function mergeScores(
  target: Map<string, { evaluation_id: string; student_id: string; score: number | null }>,
  rows: ScoreRow[] | null | undefined,
) {
  for (const row of rows || []) {
    const evaluationId = String(row.evaluation_id || "").trim();
    const studentId = String(row.student_id || "").trim();
    if (!evaluationId || !studentId) continue;

    const raw = row.score;
    const number = raw === null || raw === undefined ? null : Number(raw);
    target.set(`${evaluationId}:${studentId}`, {
      evaluation_id: evaluationId,
      student_id: studentId,
      score: number !== null && Number.isFinite(number) ? number : null,
    });
  }
}

async function loadRosterForPeriod(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  period: PeriodRow,
) {
  let query = srv
    .from("class_enrollments")
    .select("student_id,start_date,end_date,students:student_id(id,full_name,first_name,last_name,matricule)")
    .eq("class_id", classId);

  if (period.end_date) {
    query = query.or(`start_date.lte.${period.end_date},start_date.is.null`);
  }
  if (period.start_date) {
    query = query.or(`end_date.gte.${period.start_date},end_date.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rosterMap = new Map<string, RosterItem>();
  for (const row of data || []) {
    const student = Array.isArray((row as any).students)
      ? (row as any).students[0]
      : (row as any).students || {};
    const id = String(student?.id || (row as any).student_id || "").trim();
    if (!id) continue;

    const fullName =
      cleanName(student?.last_name, student?.first_name) ||
      cleanName(student?.full_name) ||
      "Élève";

    rosterMap.set(id, {
      id,
      full_name: fullName,
      matricule: student?.matricule ? String(student.matricule) : null,
    });
  }

  return rosterMap;
}

function buildPeriodScope(periodId: string, period: PeriodRow) {
  const alternatives = [`grading_period_id.eq.${periodId}`];
  const legacyDateScope = ["grading_period_id.is.null"];

  if (period.start_date) legacyDateScope.push(`eval_date.gte.${period.start_date}`);
  if (period.end_date) legacyDateScope.push(`eval_date.lte.${period.end_date}`);

  if (legacyDateScope.length > 1) {
    alternatives.push(`and(${legacyDateScope.join(",")})`);
  }

  return alternatives.join(",");
}

async function includeStudentsReferencedByScores(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  rosterMap: Map<string, RosterItem>,
  scores: Array<{ evaluation_id: string; student_id: string; score: number | null }>,
) {
  const missingIds = uniqueStrings(
    scores
      .map((row) => row.student_id)
      .filter((studentId) => !rosterMap.has(String(studentId || ""))),
  );

  if (!missingIds.length) return 0;

  let added = 0;
  for (const part of chunks(missingIds)) {
    const { data, error } = await srv
      .from("students")
      .select("id,full_name,first_name,last_name,matricule")
      .in("id", part);
    if (error) throw error;

    for (const student of data || []) {
      const id = String((student as any).id || "").trim();
      if (!id || rosterMap.has(id)) continue;
      const fullName =
        cleanName((student as any).last_name, (student as any).first_name) ||
        cleanName((student as any).full_name) ||
        "Élève";
      rosterMap.set(id, {
        id,
        full_name: fullName,
        matricule: (student as any).matricule ? String((student as any).matricule) : null,
      });
      added += 1;
    }
  }

  return added;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { srv, institutionId } = auth.ctx;
    const classId = String(req.nextUrl.searchParams.get("class_id") || "").trim();
    const rawSubjectId = String(req.nextUrl.searchParams.get("subject_id") || "").trim();
    const teacherId = String(req.nextUrl.searchParams.get("teacher_id") || "").trim();
    const periodId = String(req.nextUrl.searchParams.get("grading_period_id") || "").trim();

    if (!classId || !rawSubjectId || !teacherId || !periodId) {
      return bad("MISSING_FILTERS", 400);
    }

    const classRow = await ensureClass(srv, institutionId, classId);
    if (!classRow) return bad("CLASS_NOT_FOUND", 404);

    const period = await ensurePeriod(srv, institutionId, periodId);
    if (!period) return bad("GRADE_PERIOD_NOT_FOUND", 404);

    if (
      period.academic_year &&
      classRow.academic_year &&
      String(period.academic_year) !== String(classRow.academic_year)
    ) {
      return bad("ACADEMIC_YEAR_MISMATCH", 400);
    }

    const subject = await resolveSubjectIds(srv, institutionId, rawSubjectId);
    if (!subject.globalId || !subject.ids.length) return bad("SUBJECT_NOT_FOUND", 404);

    const assigned = await ensureTeacherAssignment(
      srv,
      institutionId,
      classId,
      teacherId,
      subject.ids,
    );
    if (!assigned) return bad("TEACHER_NOT_ASSIGNED", 403);

    const rosterMap = await loadRosterForPeriod(srv, classId, period);

    const evaluationQuery = srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,grading_period_id,academic_year,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at,publication_status,submitted_at,reviewed_at",
      )
      .eq("class_id", classId)
      .eq("teacher_id", teacherId)
      .in("subject_id", subject.ids)
      .or(buildPeriodScope(periodId, period))
      .order("eval_date", { ascending: true })
      .order("id", { ascending: true });

    const { data: evaluationsRaw, error: evalError } = await evaluationQuery;
    if (evalError) throw evalError;

    const evaluations = (evaluationsRaw || []) as unknown as EvaluationRow[];
    const evaluationIds = uniqueStrings(evaluations.map((ev) => ev.id));

    const publishedEvaluationIds = evaluations
      .filter((ev) => {
        const status = String(ev.publication_status || "").toLowerCase();
        return ev.is_published === true || status === "published";
      })
      .map((ev) => ev.id);
    const publishedSet = new Set(publishedEvaluationIds);
    const workingEvaluationIds = evaluationIds.filter((id) => !publishedSet.has(id));

    const scoreMap = new Map<
      string,
      { evaluation_id: string; student_id: string; score: number | null }
    >();

    for (const part of chunks(workingEvaluationIds)) {
      const { data: workingRows, error: workingError } = await srv
        .from("student_grades")
        .select("evaluation_id,student_id,score")
        .in("evaluation_id", part);
      if (workingError) throw workingError;
      mergeScores(scoreMap, workingRows as ScoreRow[] | null);
    }

    for (const part of chunks(publishedEvaluationIds)) {
      const { data: officialRows, error: officialError } = await srv
        .from("v_grade_scores_official_for_reports")
        .select("evaluation_id,student_id,score")
        .in("evaluation_id", part);
      if (officialError) throw officialError;
      mergeScores(scoreMap, officialRows as ScoreRow[] | null);
    }

    const scores = Array.from(scoreMap.values());
    const recoveredStudents = await includeStudentsReferencedByScores(srv, rosterMap, scores);
    const roster = Array.from(rosterMap.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name, "fr", {
        sensitivity: "base",
        numeric: true,
      }),
    );

    const componentIds = uniqueStrings(evaluations.map((ev) => ev.subject_component_id));
    const componentLabels = new Map<string, string>();
    if (componentIds.length) {
      const { data: componentRows, error: componentError } = await srv
        .from("grade_subject_components")
        .select("id,label,short_label")
        .in("id", componentIds);
      if (componentError) throw componentError;

      for (const row of componentRows || []) {
        componentLabels.set(
          String((row as any).id),
          String((row as any).short_label || (row as any).label || ""),
        );
      }
    }

    const { data: componentsRaw, error: componentsError } = await srv
      .from("grade_subject_components")
      .select("id,label,short_label,coeff_in_subject,order_index,level,is_active")
      .eq("institution_id", institutionId)
      .eq("subject_id", subject.globalId)
      .eq("is_active", true)
      .order("order_index", { ascending: true });
    if (componentsError) throw componentsError;
    const classLevelCode = getClassLevelCode(classRow);
    const components = (componentsRaw || []).filter((row: any) => {
      const componentLevel = String(row?.level || "").trim();
      return !componentLevel || componentLevel === classLevelCode;
    });

    const locks = await readLocks(srv, evaluationIds);
    const legacyPeriodEvaluations = evaluations.filter((ev) => !ev.grading_period_id).length;

    return json({
      ok: true,
      meta: {
        subject_ids_used: subject.ids,
        evaluations_count: evaluations.length,
        published_evaluations_count: publishedEvaluationIds.length,
        working_evaluations_count: workingEvaluationIds.length,
        legacy_period_evaluations_count: legacyPeriodEvaluations,
        recovered_students_from_scores: recoveredStudents,
        education_scope: {
          education_type: normalizeClassEducationType(classRow),
          formation_code: classRow.formation_code || null,
          formation_level_code: classRow.formation_level_code || null,
          class_id: classRow.id,
        },
      },
      class: {
        id: classRow.id,
        label: classRow.label || "Classe",
        level: classLevelCode || null,
        education_type: normalizeClassEducationType(classRow),
        formation_code: classRow.formation_code || null,
        formation_level_code: classRow.formation_level_code || null,
        academic_year: classRow.academic_year || null,
      },
      period,
      subject: {
        id: subject.globalId,
        raw_id: rawSubjectId,
        ids_used: subject.ids,
        label: subject.label || "Matière",
      },
      teacher_id: teacherId,
      roster,
      evaluations: evaluations.map((ev, index) => ({
        ...ev,
        column_label: `Note ${index + 1}`,
        component_label: ev.subject_component_id
          ? componentLabels.get(ev.subject_component_id) || null
          : null,
        is_locked: locks.get(ev.id) === true,
        editable: isEvaluationEditable(ev, locks.get(ev.id) === true),
      })),
      scores,
      components,
    });
  } catch (error: any) {
    console.error("[admin/grades/register] GET", error);
    return bad(error?.message || "REGISTER_LOAD_FAILED", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { srv, userId, institutionId } = auth.ctx;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (action === "create_evaluation") {
      const classId = String(body.class_id || "").trim();
      const rawSubjectId = String(body.subject_id || "").trim();
      const teacherId = String(body.teacher_id || "").trim();
      const periodId = String(body.grading_period_id || "").trim();
      const evalDate = String(body.eval_date || "").trim();
      const evalKind = String(body.eval_kind || "devoir") as EvalKind;
      const scale = Number(body.scale || 20);
      const coeff = Number(body.coeff || 1);
      const componentId = String(body.subject_component_id || "").trim() || null;

      if (!classId || !rawSubjectId || !teacherId || !periodId || !evalDate) {
        return bad("MISSING_FIELDS", 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evalDate)) return bad("INVALID_DATE", 400);
      if (!["devoir", "interro_ecrite", "interro_orale"].includes(evalKind)) {
        return bad("INVALID_EVAL_KIND", 400);
      }
      if (![5, 10, 20, 40, 60].includes(scale)) return bad("INVALID_SCALE", 400);
      if (!Number.isFinite(coeff) || coeff <= 0 || coeff > 20) return bad("INVALID_COEFF", 400);

      const classRow = await ensureClass(srv, institutionId, classId);
      if (!classRow) return bad("CLASS_NOT_FOUND", 404);
      const period = await ensurePeriod(srv, institutionId, periodId);
      if (!period) return bad("GRADE_PERIOD_NOT_FOUND", 404);
      if (
        period.academic_year &&
        classRow.academic_year &&
        String(period.academic_year) !== String(classRow.academic_year)
      ) {
        return bad("ACADEMIC_YEAR_MISMATCH", 400);
      }
      if (period.start_date && evalDate < period.start_date) return bad("DATE_OUTSIDE_PERIOD", 400);
      if (period.end_date && evalDate > period.end_date) return bad("DATE_OUTSIDE_PERIOD", 400);

      const subject = await resolveSubjectIds(srv, institutionId, rawSubjectId);
      if (!subject.globalId || !subject.ids.length) return bad("SUBJECT_NOT_FOUND", 404);
      const assigned = await ensureTeacherAssignment(
        srv,
        institutionId,
        classId,
        teacherId,
        subject.ids,
      );
      if (!assigned) return bad("TEACHER_NOT_ASSIGNED", 403);

      if (componentId) {
        const { data: component, error: componentError } = await srv
          .from("grade_subject_components")
          .select("id,subject_id,institution_id,is_active,level")
          .eq("id", componentId)
          .eq("institution_id", institutionId)
          .eq("subject_id", subject.globalId)
          .maybeSingle();
        if (componentError) throw componentError;
        if (!component || component.is_active === false) return bad("INVALID_COMPONENT", 400);
        const componentLevel = String(component.level || "").trim();
        if (
          componentLevel &&
          componentLevel !== getClassLevelCode(classRow)
        ) {
          return bad("COMPONENT_CLASS_CONTEXT_MISMATCH", 400);
        }
      }

      const { data, error } = await srv
        .from("grade_evaluations")
        .insert({
          class_id: classId,
          subject_id: subject.globalId,
          subject_component_id: componentId,
          grading_period_id: periodId,
          academic_year: period.academic_year || classRow.academic_year || null,
          teacher_id: teacherId,
          eval_date: evalDate,
          eval_kind: evalKind,
          scale,
          coeff,
          is_published: false,
          published_at: null,
          publication_status: "draft",
          publication_version: 0,
        })
        .select("id")
        .single();

      if (error) throw error;
      return json({ ok: true, evaluation_id: data.id });
    }

    if (action === "save_scores") {
      const evaluationId = String(body.evaluation_id || "").trim();
      const items = Array.isArray(body.items) ? (body.items as ScoreInput[]) : [];
      if (!evaluationId) return bad("MISSING_EVALUATION", 400);

      const { data: evaluation, error: evalError } = await srv
        .from("grade_evaluations")
        .select("id,class_id,scale,is_published,publication_status")
        .eq("id", evaluationId)
        .maybeSingle();
      if (evalError) throw evalError;
      if (!evaluation) return bad("EVALUATION_NOT_FOUND", 404);

      const classRow = await ensureClass(srv, institutionId, String(evaluation.class_id));
      if (!classRow) return bad("FORBIDDEN", 403);

      const status = String(evaluation.publication_status || "draft").toLowerCase();
      if (evaluation.is_published === true || status === "published" || status === "submitted") {
        return bad("EVALUATION_READ_ONLY", 423);
      }

      const locks = await readLocks(srv, [evaluationId]);
      if (locks.get(evaluationId) === true) return bad("EVALUATION_LOCKED", 423);

      const { data: enrollmentRows, error: enrollmentError } = await srv
        .from("class_enrollments")
        .select("student_id")
        .eq("class_id", evaluation.class_id);
      if (enrollmentError) throw enrollmentError;
      const allowedStudents = new Set(
        (enrollmentRows || []).map((row: any) => String(row.student_id)),
      );

      const scale = Number(evaluation.scale || 20);
      const upserts: Array<{
        evaluation_id: string;
        student_id: string;
        score: number;
        comment: null;
        updated_by: string;
      }> = [];
      const deletes: string[] = [];

      for (const item of items) {
        const studentId = String(item?.student_id || "").trim();
        if (!studentId || !allowedStudents.has(studentId)) continue;
        if (item.score === null || item.score === undefined || item.score === ("" as any)) {
          deletes.push(studentId);
          continue;
        }
        const score = Number(item.score);
        if (!Number.isFinite(score) || score < 0 || score > scale) {
          return bad("INVALID_SCORE", 422, { student_id: studentId, scale });
        }
        upserts.push({
          evaluation_id: evaluationId,
          student_id: studentId,
          score: Math.round(score * 100) / 100,
          comment: null,
          updated_by: userId,
        });
      }

      if (upserts.length) {
        const { error } = await srv
          .from("student_grades")
          .upsert(upserts, { onConflict: "evaluation_id,student_id" });
        if (error) throw error;
      }

      if (deletes.length) {
        const { error } = await srv
          .from("student_grades")
          .delete()
          .eq("evaluation_id", evaluationId)
          .in("student_id", deletes);
        if (error) throw error;
      }

      return json({
        ok: true,
        evaluation_id: evaluationId,
        upserted: upserts.length,
        deleted: deletes.length,
      });
    }

    return bad("UNSUPPORTED_ACTION", 400);
  } catch (error: any) {
    console.error("[admin/grades/register] POST", error);
    return bad(error?.message || "REGISTER_WRITE_FAILED", 500);
  }
}
