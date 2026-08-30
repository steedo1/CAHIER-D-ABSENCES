import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  buildCouncilYearDecisionUpsert,
  COUNCIL_YEAR_DECISION_CONTRACT,
  readCouncilYearDecision,
} from "@/lib/end-of-year-decisions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DECISIONS_PER_REQUEST = 200;

type AdminContext =
  | { ok: true; userId: string; institutionId: string }
  | { ok: false; error: string; status: number };

type DecisionInput = {
  student_id?: unknown;
  annual_avg?: unknown;
  annual_rank?: unknown;
  council_decision?: unknown;
  reason?: unknown;
};

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  );
}

function cleanAcademicYear(value: unknown) {
  const year = String(value || "").trim();
  return year.length >= 4 && year.length <= 32 ? year : "";
}

function isStorageUnavailable(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("student_year_decisions") &&
      (message.includes("does not exist") || message.includes("schema cache"))
  );
}

async function getAdminContext(): Promise<AdminContext> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "UNAUTHENTICATED", status: 401 };
  }

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin", "file_correspondent"])
    .limit(1)
    .maybeSingle();

  if (roleError || !roleRow) {
    return { ok: false, error: "FORBIDDEN", status: 403 };
  }

  const institutionId = String((roleRow as any).institution_id || "").trim();
  if (!isUuid(institutionId)) {
    return { ok: false, error: "NO_INSTITUTION", status: 400 };
  }

  return { ok: true, userId: user.id, institutionId };
}

async function resolveEndOfYearScope(input: {
  institutionId: string;
  classId: string;
  academicYear: string;
  periodId: string;
}) {
  const srv = getSupabaseServiceClient() as any;
  const { data: classRow, error: classError } = await srv
    .from("classes")
    .select("id, institution_id, academic_year")
    .eq("id", input.classId)
    .maybeSingle();

  if (classError) return { ok: false as const, error: "CLASS_ERROR", status: 500 };
  if (!classRow || String(classRow.institution_id || "") !== input.institutionId) {
    return { ok: false as const, error: "FORBIDDEN_CLASS", status: 403 };
  }
  if (String(classRow.academic_year || "") !== input.academicYear) {
    return { ok: false as const, error: "ACADEMIC_YEAR_MISMATCH", status: 400 };
  }

  const { data: periods, error: periodsError } = await srv
    .from("grade_periods")
    .select("id, code, start_date, end_date, academic_year")
    .eq("institution_id", input.institutionId)
    .eq("academic_year", input.academicYear)
    .order("start_date", { ascending: true })
    .order("end_date", { ascending: true });

  if (periodsError) {
    return { ok: false as const, error: "PERIODS_ERROR", status: 500 };
  }
  const periodRows = Array.isArray(periods) ? periods : [];
  const lastPeriod = periodRows[periodRows.length - 1] || null;
  if (!lastPeriod || String(lastPeriod.id || "") !== input.periodId) {
    return { ok: false as const, error: "NOT_LAST_PERIOD", status: 409 };
  }

  return {
    ok: true as const,
    classRow,
    period: {
      id: String(lastPeriod.id),
      code: lastPeriod.code ? String(lastPeriod.code) : null,
      from: lastPeriod.start_date ? String(lastPeriod.start_date).slice(0, 10) : null,
      to: lastPeriod.end_date ? String(lastPeriod.end_date).slice(0, 10) : null,
      is_last: true,
    },
  };
}

async function resolveRequestScope(req: NextRequest, body?: any) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return ctx;

  const url = new URL(req.url);
  const classId = String(body?.class_id ?? url.searchParams.get("class_id") ?? "").trim();
  const academicYear = cleanAcademicYear(
    body?.academic_year ?? url.searchParams.get("academic_year"),
  );
  const periodId = String(body?.period_id ?? url.searchParams.get("period_id") ?? "").trim();

  if (!isUuid(classId)) return { ok: false as const, error: "INVALID_CLASS_ID", status: 400 };
  if (!academicYear) return { ok: false as const, error: "INVALID_ACADEMIC_YEAR", status: 400 };
  if (!isUuid(periodId)) return { ok: false as const, error: "INVALID_PERIOD_ID", status: 400 };

  const scope = await resolveEndOfYearScope({
    institutionId: ctx.institutionId,
    classId,
    academicYear,
    periodId,
  });
  if (!scope.ok) return scope;

  return {
    ok: true as const,
    userId: ctx.userId,
    institutionId: ctx.institutionId,
    classId,
    academicYear,
    period: scope.period,
  };
}

export async function GET(req: NextRequest) {
  const scope = await resolveRequestScope(req);
  if (!scope.ok) return jsonError(scope.error, scope.status);

  const srv = getSupabaseServiceClient() as any;
  const { data, error } = await srv
    .from("student_year_decisions")
    .select(
      "id, student_id, institution_id, academic_year, current_class_id, decision_type, decision_label, decided_at, decided_by, notes, metadata_json, created_at, updated_at",
    )
    .eq("institution_id", scope.institutionId)
    .eq("current_class_id", scope.classId)
    .eq("academic_year", scope.academicYear);

  if (error) {
    if (isStorageUnavailable(error)) {
      return jsonError("DECISION_STORAGE_UNAVAILABLE", 503, {
        storage: {
          table: "student_year_decisions",
          contract: COUNCIL_YEAR_DECISION_CONTRACT,
          available: false,
          ddl_applied_by_this_mission: false,
        },
      });
    }
    console.error("[council.year-decisions] GET failed", error);
    return jsonError("DECISIONS_FETCH_FAILED", 500);
  }

  return NextResponse.json({
    ok: true,
    storage: {
      table: "student_year_decisions",
      contract: COUNCIL_YEAR_DECISION_CONTRACT,
      available: true,
    },
    meta: {
      institution_id: scope.institutionId,
      class_id: scope.classId,
      academic_year: scope.academicYear,
      period_id: scope.period.id,
      is_last_period: true,
    },
    items: (data || []).map((row: any) => ({
      id: row.id,
      student_id: row.student_id,
      decision_type: row.decision_type,
      decision_label: row.decision_label,
      decided_at: row.decided_at,
      decided_by: row.decided_by,
      notes: row.notes,
      metadata_json: row.metadata_json,
      updated_at: row.updated_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  const scope = await resolveRequestScope(req, body);
  if (!scope.ok) return jsonError(scope.error, scope.status);

  if (body?.state !== "validated") {
    return jsonError("VALIDATED_STATE_REQUIRED", 400);
  }
  const state = "validated" as const;
  const inputs: DecisionInput[] = Array.isArray(body?.items) ? body.items : [];
  if (inputs.length === 0 || inputs.length > MAX_DECISIONS_PER_REQUEST) {
    return jsonError("INVALID_ITEMS_COUNT", 400, {
      min: 1,
      max: MAX_DECISIONS_PER_REQUEST,
    });
  }

  const studentIds = inputs.map((item) => String(item?.student_id || "").trim());
  if (studentIds.some((id) => !isUuid(id)) || new Set(studentIds).size !== studentIds.length) {
    return jsonError("INVALID_STUDENT_IDS", 400);
  }

  const srv = getSupabaseServiceClient() as any;
  const { data: enrollments, error: enrollmentError } = await srv
    .from("class_enrollments")
    .select("student_id")
    .eq("class_id", scope.classId)
    .in("student_id", studentIds);

  if (enrollmentError) {
    console.error("[council.year-decisions] enrollments failed", enrollmentError);
    return jsonError("ENROLLMENTS_FETCH_FAILED", 500);
  }

  const allowedStudentIds = new Set(
    (enrollments || []).map((row: any) => String(row.student_id || "")).filter(Boolean),
  );
  if (studentIds.some((id) => !allowedStudentIds.has(id))) {
    return jsonError("FORBIDDEN_STUDENT", 403);
  }

  const { data: existingRows, error: existingError } = await srv
    .from("student_year_decisions")
    .select("student_id, metadata_json")
    .eq("institution_id", scope.institutionId)
    .eq("current_class_id", scope.classId)
    .eq("academic_year", scope.academicYear)
    .in("student_id", studentIds);

  if (existingError && isStorageUnavailable(existingError)) {
    return jsonError("DECISION_STORAGE_UNAVAILABLE", 503, {
      storage: {
        table: "student_year_decisions",
        contract: COUNCIL_YEAR_DECISION_CONTRACT,
        available: false,
        ddl_applied_by_this_mission: false,
      },
    });
  }
  if (existingError) {
    console.error("[council.year-decisions] existing rows failed", existingError);
    return jsonError("DECISIONS_FETCH_FAILED", 500);
  }

  const existingByStudent = new Map(
    (existingRows || []).map((row: any) => [String(row.student_id), row.metadata_json]),
  );
  const recordedAt = new Date().toISOString();
  const built = inputs.map((item) =>
    buildCouncilYearDecisionUpsert({
      student_id: String(item.student_id),
      institution_id: scope.institutionId,
      academic_year: scope.academicYear,
      class_id: scope.classId,
      annual_average: item.annual_avg,
      annual_rank: item.annual_rank,
      council_decision: item.council_decision,
      reason: item.reason,
      state,
      author_id: scope.userId,
      recorded_at: recordedAt,
      existing_metadata: existingByStudent.get(String(item.student_id)),
      period: scope.period,
    }),
  );

  const invalid = built.find((item) => !item.ok);
  if (invalid && !invalid.ok) {
    return jsonError(String(invalid.error || "INVALID_DECISION"), 400);
  }

  const payloads = built
    .filter((item): item is Extract<(typeof built)[number], { ok: true }> => item.ok)
    .map((item) => item.payload);
  const { data: savedRows, error: saveError } = await srv
    .from("student_year_decisions")
    .upsert(payloads, { onConflict: "institution_id,student_id,academic_year" })
    .select(
      "id, student_id, decision_type, decision_label, decided_at, decided_by, notes, metadata_json, updated_at",
    );

  if (saveError) {
    if (isStorageUnavailable(saveError)) {
      return jsonError("DECISION_STORAGE_UNAVAILABLE", 503, {
        storage: {
          table: "student_year_decisions",
          contract: COUNCIL_YEAR_DECISION_CONTRACT,
          available: false,
          ddl_applied_by_this_mission: false,
        },
      });
    }
    console.error("[council.year-decisions] save failed", saveError);
    return jsonError("DECISIONS_SAVE_FAILED", 500);
  }

  const averageByStudent = new Map(
    inputs.map((item) => [String(item.student_id), item.annual_avg]),
  );
  return NextResponse.json({
    ok: true,
    storage: {
      table: "student_year_decisions",
      contract: COUNCIL_YEAR_DECISION_CONTRACT,
      available: true,
    },
    state,
    items: (savedRows || []).map((row: any) =>
      readCouncilYearDecision(row, averageByStudent.get(String(row.student_id))),
    ),
  });
}
