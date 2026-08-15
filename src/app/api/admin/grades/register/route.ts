import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

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

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return json({ ok: false, error, ...(extra || {}) }, status);
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
    .select("id,label,level,academic_year,institution_id")
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
  if (!raw) return { raw: "", globalId: "", instId: "" };

  const { data: direct } = await srv
    .from("subjects")
    .select("id,name,code")
    .eq("id", raw)
    .maybeSingle();

  if (direct?.id) {
    const { data: inst } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name")
      .eq("institution_id", institutionId)
      .eq("subject_id", direct.id)
      .maybeSingle();

    return {
      raw,
      globalId: String(direct.id),
      instId: inst?.id ? String(inst.id) : "",
      label: String(inst?.custom_name || direct.name || direct.code || "Matière"),
    };
  }

  const { data: inst } = await srv
    .from("institution_subjects")
    .select("id,subject_id,custom_name,subj:subjects(id,name,code)")
    .eq("institution_id", institutionId)
    .eq("id", raw)
    .maybeSingle();

  const subject = (inst as any)?.subj || null;
  return {
    raw,
    globalId: String(inst?.subject_id || subject?.id || ""),
    instId: String(inst?.id || ""),
    label: String(inst?.custom_name || subject?.name || subject?.code || "Matière"),
  };
}

async function ensureTeacherAssignment(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
  teacherId: string,
  subjectCandidates: string[],
) {
  if (!teacherId || !subjectCandidates.length) return false;

  const { data, error } = await srv
    .from("class_teachers")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .eq("teacher_id", teacherId)
    .in("subject_id", subjectCandidates)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function ensurePeriod(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  periodId: string,
) {
  const { data, error } = await srv
    .from("grade_periods")
    .select("id,institution_id,academic_year,start_date,end_date,is_active,label,short_label,code")
    .eq("id", periodId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
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
  const status = String(ev.publication_status || "draft");
  return (
    !locked &&
    ev.is_published !== true &&
    status !== "published" &&
    status !== "submitted"
  );
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

    const subject = await resolveSubjectIds(srv, institutionId, rawSubjectId);
    if (!subject.globalId) return bad("SUBJECT_NOT_FOUND", 404);

    const subjectCandidates = Array.from(
      new Set([subject.raw, subject.globalId, subject.instId].filter(Boolean)),
    );
    const assigned = await ensureTeacherAssignment(
      srv,
      institutionId,
      classId,
      teacherId,
      subjectCandidates,
    );
    if (!assigned) return bad("TEACHER_NOT_ASSIGNED", 403);

    const { data: enrollments, error: rosterError } = await srv
      .from("class_enrollments")
      .select("student_id,students:student_id(id,first_name,last_name,matricule)")
      .eq("class_id", classId);

    if (rosterError) throw rosterError;

    const rosterMap = new Map<string, { id: string; full_name: string; matricule: string | null }>();
    for (const row of enrollments || []) {
      const student = (row as any).students || {};
      const id = String(student.id || (row as any).student_id || "").trim();
      if (!id) continue;
      const fullName = [student.last_name, student.first_name]
        .filter(Boolean)
        .join(" ")
        .trim() || "Élève";
      rosterMap.set(id, {
        id,
        full_name: fullName,
        matricule: student.matricule ? String(student.matricule) : null,
      });
    }
    const roster = Array.from(rosterMap.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base" }),
    );

    const { data: evaluationsRaw, error: evalError } = await srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,grading_period_id,academic_year,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at,publication_status,submitted_at,reviewed_at",
      )
      .eq("class_id", classId)
      .eq("teacher_id", teacherId)
      .eq("subject_id", subject.globalId)
      .eq("grading_period_id", periodId)
      .order("eval_date", { ascending: true })
      .order("id", { ascending: true });

    if (evalError) throw evalError;
    const evaluations = (evaluationsRaw || []) as unknown as EvaluationRow[];
    const evaluationIds = evaluations.map((ev) => ev.id);

    const scores: Array<{ evaluation_id: string; student_id: string; score: number | null }> = [];
    if (evaluationIds.length) {
      const { data: scoreRows, error: scoreError } = await srv
        .from("student_grades")
        .select("evaluation_id,student_id,score")
        .in("evaluation_id", evaluationIds);
      if (scoreError) throw scoreError;

      for (const row of scoreRows || []) {
        const value = (row as any).score;
        const number = value === null || value === undefined ? null : Number(value);
        scores.push({
          evaluation_id: String((row as any).evaluation_id),
          student_id: String((row as any).student_id),
          score: number !== null && Number.isFinite(number) ? number : null,
        });
      }
    }

    const componentIds = Array.from(
      new Set(evaluations.map((ev) => ev.subject_component_id).filter((id): id is string => !!id)),
    );
    const componentLabels = new Map<string, string>();
    if (componentIds.length) {
      const { data: componentRows } = await srv
        .from("grade_subject_components")
        .select("id,label,short_label")
        .in("id", componentIds);
      for (const row of componentRows || []) {
        componentLabels.set(
          String((row as any).id),
          String((row as any).short_label || (row as any).label || ""),
        );
      }
    }

    const { data: componentsRaw } = await srv
      .from("grade_subject_components")
      .select("id,label,short_label,coeff_in_subject,order_index,level,is_active")
      .eq("institution_id", institutionId)
      .eq("subject_id", subject.globalId)
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    const locks = await readLocks(srv, evaluationIds);

    return json({
      ok: true,
      class: {
        id: classRow.id,
        label: classRow.label || "Classe",
        level: classRow.level || null,
        academic_year: classRow.academic_year || null,
      },
      period,
      subject: {
        id: subject.globalId,
        raw_id: rawSubjectId,
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
      components: Array.isArray(componentsRaw) ? componentsRaw : [],
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
      if (period.academic_year && classRow.academic_year && period.academic_year !== classRow.academic_year) {
        return bad("ACADEMIC_YEAR_MISMATCH", 400);
      }
      if (period.start_date && evalDate < period.start_date) return bad("DATE_OUTSIDE_PERIOD", 400);
      if (period.end_date && evalDate > period.end_date) return bad("DATE_OUTSIDE_PERIOD", 400);

      const subject = await resolveSubjectIds(srv, institutionId, rawSubjectId);
      if (!subject.globalId) return bad("SUBJECT_NOT_FOUND", 404);
      const subjectCandidates = Array.from(
        new Set([subject.raw, subject.globalId, subject.instId].filter(Boolean)),
      );
      const assigned = await ensureTeacherAssignment(
        srv,
        institutionId,
        classId,
        teacherId,
        subjectCandidates,
      );
      if (!assigned) return bad("TEACHER_NOT_ASSIGNED", 403);

      if (componentId) {
        const { data: component } = await srv
          .from("grade_subject_components")
          .select("id,subject_id,institution_id,is_active")
          .eq("id", componentId)
          .eq("institution_id", institutionId)
          .eq("subject_id", subject.globalId)
          .maybeSingle();
        if (!component || component.is_active === false) return bad("INVALID_COMPONENT", 400);
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

      const status = String(evaluation.publication_status || "draft");
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
      const allowedStudents = new Set((enrollmentRows || []).map((row: any) => String(row.student_id)));

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
