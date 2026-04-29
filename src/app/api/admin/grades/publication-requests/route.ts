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

type Role = "super_admin" | "admin" | "educator" | string;

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

type ScoreSource = "student_grades" | "grade_published_scores";

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
  comment?: string | null;
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

function pickSubjectName(row?: SubjectRow | null) {
  return (
    cleanText(row?.name) ||
    cleanText(row?.label) ||
    cleanText(row?.title) ||
    "Matière"
  );
}

function pickProfileName(row?: ProfileRow | null) {
  const explicit = cleanText(row?.full_name) || cleanText(row?.display_name);
  if (explicit) return explicit;

  const combined = [row?.first_name, row?.last_name]
    .map((x) => cleanText(x))
    .filter(Boolean)
    .join(" ");

  return combined || cleanText(row?.email) || "Utilisateur";
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
  return ev.is_published === true || normalizeStatus(ev.publication_status) === "published"
    ? "grade_published_scores"
    : "student_grades";
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
      const n = row.score === null || row.score === undefined ? NaN : Number(row.score);
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
    console.error(
      "[admin/grades/publication-requests] roles error",
      rolesErr
    );

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
  subjectIds: string[]
) {
  const ids = Array.from(new Set(subjectIds.filter(Boolean)));
  const map = new Map<string, SubjectRow>();

  if (!ids.length) return map;

  const { data, error } = await srv
    .from("subjects")
    .select("id,name,label,title")
    .in("id", ids);

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

  return map;
}

async function fetchProfileMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileIds: string[]
) {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  const map = new Map<string, ProfileRow>();

  if (!ids.length) return map;

  const broad = await srv
    .from("profiles")
    .select("id,full_name,display_name,first_name,last_name,email")
    .in("id", ids);

  if (!broad.error) {
    for (const row of broad.data ?? []) {
      map.set(String((row as any).id), row as unknown as ProfileRow);
    }

    return map;
  }

  const narrow = await srv.from("profiles").select("id,email").in("id", ids);

  if (!narrow.error) {
    for (const row of narrow.data ?? []) {
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

async function fetchRosterStudentIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  fallbackIds: string[]
) {
  try {
    const { data, error } = await srv
      .from("class_students")
      .select("student_id")
      .eq("class_id", classId);

    if (!error && Array.isArray(data) && data.length > 0) {
      return Array.from(
        new Set(data.map((row: any) => String(row.student_id)).filter(Boolean))
      );
    }
  } catch {
    // fallback silencieux
  }

  return Array.from(new Set(fallbackIds.filter(Boolean)));
}

async function fetchRosterMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classIds: string[]
) {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  const map = new Map<string, Set<string>>();

  if (!uniqueClassIds.length) return map;

  try {
    const { data, error } = await srv
      .from("class_students")
      .select("class_id,student_id")
      .in("class_id", uniqueClassIds);

    if (error || !Array.isArray(data)) return map;

    for (const row of data) {
      const classId = String((row as any).class_id || "");
      const studentId = String((row as any).student_id || "");

      if (!classId || !studentId) continue;

      if (!map.has(classId)) map.set(classId, new Set<string>());
      map.get(classId)?.add(studentId);
    }
  } catch {
    // fallback silencieux
  }

  return map;
}

async function fetchScoreRowsByEvaluation(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evaluations: EvaluationRow[]
) {
  const byEval = new Map<string, ScoreRow[]>();

  for (const ev of evaluations) {
    byEval.set(ev.id, []);
  }

  const workingIds = evaluations
    .filter((ev) => scoreSourceForEvaluation(ev) === "student_grades")
    .map((ev) => ev.id);

  const officialIds = evaluations
    .filter((ev) => scoreSourceForEvaluation(ev) === "grade_published_scores")
    .map((ev) => ev.id);

  if (workingIds.length) {
    const { data, error } = await srv
      .from("student_grades")
      .select("evaluation_id,student_id,score,comment")
      .in("evaluation_id", workingIds);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const item: ScoreRow = {
          evaluation_id: String((row as any).evaluation_id),
          student_id: String((row as any).student_id),
          score:
            (row as any).score === null || (row as any).score === undefined
              ? null
              : Number((row as any).score),
          comment: (row as any).comment ?? null,
        };

        byEval.get(item.evaluation_id)?.push(item);
      }
    }
  }

  if (officialIds.length) {
    const { data, error } = await srv
      .from("grade_published_scores")
      .select("evaluation_id,student_id,score")
      .in("evaluation_id", officialIds)
      .eq("is_current", true);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const item: ScoreRow = {
          evaluation_id: String((row as any).evaluation_id),
          student_id: String((row as any).student_id),
          score:
            (row as any).score === null || (row as any).score === undefined
              ? null
              : Number((row as any).score),
          comment: null,
        };

        byEval.get(item.evaluation_id)?.push(item);
      }
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

  const profileIds = evaluations
    .flatMap((ev) => [ev.teacher_id, ev.submitted_by, ev.reviewed_by])
    .filter((x): x is string => !!x);

  const [classMap, subjectMap, profileMap, rosterMap, scoresByEval] =
    await Promise.all([
      fetchClassMap(srv, institutionId, classIds),
      fetchSubjectMap(srv, subjectIds),
      fetchProfileMap(srv, profileIds),
      fetchRosterMap(srv, classIds),
      fetchScoreRowsByEvaluation(srv, evaluations),
    ]);

  return evaluations.map((ev) => {
    const cls = classMap.get(ev.class_id);
    const subject = ev.subject_id ? subjectMap.get(ev.subject_id) : null;
    const teacher = ev.teacher_id ? profileMap.get(ev.teacher_id) : null;
    const submittedBy = ev.submitted_by ? profileMap.get(ev.submitted_by) : null;
    const reviewedBy = ev.reviewed_by ? profileMap.get(ev.reviewed_by) : null;

    const scoreRows = scoresByEval.get(ev.id) ?? [];
    const rosterSet = rosterMap.get(ev.class_id);
    const fallbackStudentCount = new Set(
      scoreRows.map((row) => row.student_id).filter(Boolean)
    ).size;

    const studentCount = rosterSet?.size || fallbackStudentCount;
    const source = scoreSourceForEvaluation(ev);

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
      subject_name: ev.subject_id ? pickSubjectName(subject) : "Matière",

      subject_component_id: ev.subject_component_id,
      teacher_id: ev.teacher_id,
      teacher_name: pickProfileName(teacher),

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
      submitted_by_name: submittedBy ? pickProfileName(submittedBy) : null,

      reviewed_at: ev.reviewed_at ?? null,
      reviewed_by: ev.reviewed_by ?? null,
      reviewed_by_name: reviewedBy ? pickProfileName(reviewedBy) : null,
      review_comment: ev.review_comment ?? null,

      scores_count: stats.graded_count,
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

  const source = scoreSourceForEvaluation(evaluation);
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
      };
    })
    .sort((a, b) => {
      const an = cleanText(a.student_name).toLowerCase();
      const bn = cleanText(b.student_name).toLowerCase();
      return an.localeCompare(bn, "fr");
    });

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