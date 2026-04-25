// src/app/api/admin/grades/bulletin/nc-overrides/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | string;

type OverrideInput = {
  student_id?: string | null;
  is_nc?: boolean | null;
  reason?: string | null;
  missing_subjects?: unknown;
  missing_subjects_snapshot?: unknown;
};

type AdminContext =
  | {
      ok: true;
      userId: string;
      institutionId: string;
      role: Role;
    }
  | {
      ok: false;
      error:
        | "UNAUTHENTICATED"
        | "PROFILE_NOT_FOUND"
        | "FORBIDDEN"
        | "NO_INSTITUTION";
      status: number;
    };

type ClassContext =
  | {
      ok: true;
      classRow: any;
      academicYear: string;
    }
  | {
      ok: false;
      error: "CLASS_ERROR" | "FORBIDDEN_CLASS" | "MISSING_ACADEMIC_YEAR";
      status: number;
    };

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function isUuid(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value
    )
  );
}

function cleanDate(value: string | null | undefined) {
  const v = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function cleanScope(value: string | null | undefined): "period" | "annual" {
  return value === "annual" ? "annual" : "period";
}

function cleanMissingSubjects(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const row = item as Record<string, unknown>;
      const subjectId = String(row.subject_id ?? "").trim();
      const subjectName = String(row.subject_name ?? "").trim();

      if (!subjectId && !subjectName) return null;

      return {
        subject_id: subjectId || null,
        subject_name: subjectName || "Matière",
      };
    })
    .filter(Boolean);
}

async function getAdminAndInstitution(): Promise<AdminContext> {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "UNAUTHENTICATED", status: 401 };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { ok: false, error: "PROFILE_NOT_FOUND", status: 400 };
  }

  const role = String((roleRow as any).role || "") as Role;

  if (!["admin", "super_admin"].includes(role)) {
    return { ok: false, error: "FORBIDDEN", status: 403 };
  }

  const institutionId = String((roleRow as any).institution_id || "").trim();

  if (!institutionId) {
    return { ok: false, error: "NO_INSTITUTION", status: 400 };
  }

  return {
    ok: true,
    userId: user.id,
    institutionId,
    role,
  };
}

async function resolveClassContext(params: {
  classId: string;
  institutionId: string;
  academicYear?: string | null;
}): Promise<ClassContext> {
  const srv = getSupabaseServiceClient() as any;

  const { data: cls, error } = await srv
    .from("classes")
    .select("id, institution_id, academic_year, label, code")
    .eq("id", params.classId)
    .maybeSingle();

  if (error) {
    console.error("[bulletin.nc-overrides] class error", error);
    return { ok: false, error: "CLASS_ERROR", status: 500 };
  }

  if (!cls || String(cls.institution_id || "") !== params.institutionId) {
    return { ok: false, error: "FORBIDDEN_CLASS", status: 403 };
  }

  const academicYear =
    String(params.academicYear || "").trim() ||
    String(cls.academic_year || "").trim();

  if (!academicYear) {
    return { ok: false, error: "MISSING_ACADEMIC_YEAR", status: 400 };
  }

  return {
    ok: true,
    classRow: cls,
    academicYear,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminAndInstitution();

  if (!ctx.ok) {
    return bad(ctx.error, ctx.status);
  }

  const { searchParams } = new URL(req.url);

  const classId = String(searchParams.get("class_id") || "").trim();
  const periodFrom = cleanDate(searchParams.get("from"));
  const periodTo = cleanDate(searchParams.get("to"));
  const scope = cleanScope(searchParams.get("scope"));
  const academicYearParam = String(searchParams.get("academic_year") || "").trim();

  if (!isUuid(classId)) return bad("INVALID_CLASS_ID", 400);
  if (!periodFrom || !periodTo) return bad("INVALID_PERIOD_DATES", 400);

  const resolved = await resolveClassContext({
    classId,
    institutionId: ctx.institutionId,
    academicYear: academicYearParam,
  });

  if (!resolved.ok) {
    return bad(resolved.error, resolved.status);
  }

  const srv = getSupabaseServiceClient() as any;

  const { data, error } = await srv
    .from("bulletin_nc_overrides")
    .select(
      [
        "id",
        "class_id",
        "student_id",
        "academic_year",
        "period_from",
        "period_to",
        "scope",
        "is_nc",
        "reason",
        "missing_subjects_snapshot",
        "created_at",
        "updated_at",
      ].join(", ")
    )
    .eq("institution_id", ctx.institutionId)
    .eq("class_id", classId)
    .eq("academic_year", resolved.academicYear)
    .eq("period_from", periodFrom)
    .eq("period_to", periodTo)
    .eq("scope", scope)
    .eq("is_nc", true)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[bulletin.nc-overrides] GET error", error);
    return bad("OVERRIDES_FETCH_FAILED", 500);
  }

  return NextResponse.json({
    ok: true,
    meta: {
      class_id: classId,
      academic_year: resolved.academicYear,
      from: periodFrom,
      to: periodTo,
      scope,
      total: Array.isArray(data) ? data.length : 0,
    },
    items: data || [],
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminAndInstitution();

  if (!ctx.ok) {
    return bad(ctx.error, ctx.status);
  }

  let body: any = null;

  try {
    body = await req.json();
  } catch {
    return bad("INVALID_JSON", 400);
  }

  const classId = String(body?.class_id || "").trim();
  const periodFrom = cleanDate(body?.from ?? body?.period_from);
  const periodTo = cleanDate(body?.to ?? body?.period_to);
  const scope = cleanScope(body?.scope);
  const academicYearParam = String(body?.academic_year || "").trim();
  const inputs: OverrideInput[] = Array.isArray(body?.items) ? body.items : [];

  if (!isUuid(classId)) return bad("INVALID_CLASS_ID", 400);
  if (!periodFrom || !periodTo) return bad("INVALID_PERIOD_DATES", 400);
  if (!Array.isArray(inputs)) return bad("INVALID_ITEMS", 400);

  const resolved = await resolveClassContext({
    classId,
    institutionId: ctx.institutionId,
    academicYear: academicYearParam,
  });

  if (!resolved.ok) {
    return bad(resolved.error, resolved.status);
  }

  const srv = getSupabaseServiceClient() as any;

  const cleaned = inputs
    .map((item) => ({
      student_id: String(item?.student_id || "").trim(),
      is_nc: item?.is_nc === true,
      reason: item?.reason ? String(item.reason).trim() : null,
      missing_subjects_snapshot: cleanMissingSubjects(
        item?.missing_subjects_snapshot ?? item?.missing_subjects
      ),
    }))
    .filter((item) => isUuid(item.student_id));

  const studentIds = Array.from(new Set(cleaned.map((item) => item.student_id)));

  if (!studentIds.length) {
    return NextResponse.json({
      ok: true,
      meta: {
        class_id: classId,
        academic_year: resolved.academicYear,
        from: periodFrom,
        to: periodTo,
        scope,
        received: inputs.length,
        eligible: 0,
        upserted: 0,
        deleted: 0,
      },
    });
  }

  /*
   * Sécurité :
   * On n'accepte que les élèves réellement rattachés à la classe sur la période.
   * Cela évite qu'un admin envoie accidentellement un student_id d'une autre classe.
   */
  let enrollQuery = srv
    .from("class_enrollments")
    .select("student_id")
    .eq("class_id", classId)
    .in("student_id", studentIds);

  if (periodFrom) {
    enrollQuery = enrollQuery.or(`end_date.gte.${periodFrom},end_date.is.null`);
  }

  const { data: enrollments, error: enrollErr } = await enrollQuery;

  if (enrollErr) {
    console.error("[bulletin.nc-overrides] enrollments error", enrollErr);
    return bad("ENROLLMENTS_ERROR", 500);
  }

  const allowedStudentIds = new Set<string>(
    (enrollments || [])
      .map((row: any) => String(row.student_id || "").trim())
      .filter(Boolean)
  );

  const toEnable = cleaned.filter(
    (item) => item.is_nc && allowedStudentIds.has(item.student_id)
  );

  const toDisable = cleaned.filter(
    (item) => !item.is_nc && allowedStudentIds.has(item.student_id)
  );

  let upserted = 0;
  let deleted = 0;

  if (toEnable.length) {
    const payload = toEnable.map((item) => ({
      institution_id: ctx.institutionId,
      class_id: classId,
      student_id: item.student_id,
      academic_year: resolved.academicYear,
      period_from: periodFrom,
      period_to: periodTo,
      scope,
      is_nc: true,
      reason: item.reason,
      missing_subjects_snapshot: item.missing_subjects_snapshot,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    }));

    const { error } = await srv.from("bulletin_nc_overrides").upsert(payload, {
      onConflict:
        "institution_id,class_id,student_id,academic_year,period_from,period_to,scope",
    });

    if (error) {
      console.error("[bulletin.nc-overrides] upsert error", error);
      return bad("OVERRIDES_UPSERT_FAILED", 500);
    }

    upserted = payload.length;
  }

  if (toDisable.length) {
    const ids = toDisable.map((item) => item.student_id);

    const { error, count } = await srv
      .from("bulletin_nc_overrides")
      .delete({ count: "exact" })
      .eq("institution_id", ctx.institutionId)
      .eq("class_id", classId)
      .eq("academic_year", resolved.academicYear)
      .eq("period_from", periodFrom)
      .eq("period_to", periodTo)
      .eq("scope", scope)
      .in("student_id", ids);

    if (error) {
      console.error("[bulletin.nc-overrides] delete error", error);
      return bad("OVERRIDES_DELETE_FAILED", 500);
    }

    deleted = typeof count === "number" ? count : ids.length;
  }

  return NextResponse.json({
    ok: true,
    meta: {
      class_id: classId,
      academic_year: resolved.academicYear,
      from: periodFrom,
      to: periodTo,
      scope,
      received: inputs.length,
      eligible: allowedStudentIds.size,
      upserted,
      deleted,
    },
  });
}
