import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScholarshipStatus = "boursier" | "non_boursier" | "unknown";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStatus(value: unknown): ScholarshipStatus {
  const raw = clean(value).toLowerCase();
  if (raw === "boursier") return "boursier";
  if (raw === "non_boursier") return "non_boursier";
  return "unknown";
}

async function requireContext(classId: string) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const { data: roles, error: roleError } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleError) {
    return {
      error: NextResponse.json({ error: roleError.message }, { status: 400 }),
    };
  }

  const allowed = new Set([
    "admin",
    "super_admin",
    "founder",
    "finance_manager",
    "finance",
  ]);
  const roleRows = (roles || []).filter((row: any) =>
    allowed.has(String(row.role || "")),
  );

  let institutionId = clean((profile as any)?.institution_id);
  if (!institutionId) {
    institutionId = clean(
      roleRows.find((row: any) => row.institution_id)?.institution_id,
    );
  }
  if (!institutionId) {
    return {
      error: NextResponse.json({ error: "no_institution" }, { status: 400 }),
    };
  }

  const roleApplies = (row: any) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;
    const rowInstitution = clean(row.institution_id);
    return !rowInstitution || rowInstitution === institutionId;
  };

  if (!roleRows.some(roleApplies)) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  const { data: cls, error: classError } = await srv
    .from("classes")
    .select("id,institution_id,academic_year,level")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classError) {
    return {
      error: NextResponse.json({ error: classError.message }, { status: 400 }),
    };
  }
  if (!cls?.id) {
    return {
      error: NextResponse.json({ error: "class_not_found" }, { status: 404 }),
    };
  }

  return { srv, institutionId, cls };
}

async function resolveAcademicYear(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classAcademicYear: string | null | undefined,
  requestedAcademicYear: string,
) {
  const code = requestedAcademicYear || clean(classAcademicYear);
  if (!code) return null;

  const { data, error } = await srv
    .from("academic_years")
    .select("id,code")
    .eq("institution_id", institutionId)
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  return { id: String(data.id), code: clean(data.code) || code };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const classId = clean(id);
  if (!classId) {
    return NextResponse.json({ error: "missing_class_id" }, { status: 400 });
  }

  const ctx = await requireContext(classId);
  if ("error" in ctx) return ctx.error;
  const { srv, institutionId, cls } = ctx;

  try {
    const requested = clean(req.nextUrl.searchParams.get("academic_year"));
    const academicYear = await resolveAcademicYear(
      srv,
      institutionId,
      (cls as any).academic_year,
      requested,
    );

    if (!academicYear) {
      return NextResponse.json({
        ok: true,
        academic_year: requested || null,
        scholarships: {},
      });
    }

    const { data: enrollments, error: enrollmentError } = await srv
      .from("class_enrollments")
      .select("student_id")
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .is("end_date", null);
    if (enrollmentError) throw new Error(enrollmentError.message);

    const studentIds = (enrollments || [])
      .map((row: any) => clean(row.student_id))
      .filter(Boolean);

    if (!studentIds.length) {
      return NextResponse.json({
        ok: true,
        academic_year: academicYear.code,
        scholarships: {},
      });
    }

    const { data: profiles, error: profileError } = await srv
      .from("student_year_profiles")
      .select("student_id,scholarship_status")
      .eq("institution_id", institutionId)
      .eq("academic_year_id", academicYear.id)
      .in("student_id", studentIds);
    if (profileError) throw new Error(profileError.message);

    const scholarships: Record<string, ScholarshipStatus> = {};
    for (const studentId of studentIds) scholarships[studentId] = "unknown";
    for (const row of profiles || []) {
      const studentId = clean((row as any).student_id);
      if (studentId) {
        scholarships[studentId] = normalizeStatus(
          (row as any).scholarship_status,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      academic_year: academicYear.code,
      scholarships,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "scholarship_load_failed",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const classId = clean(id);
  if (!classId) {
    return NextResponse.json({ error: "missing_class_id" }, { status: 400 });
  }

  const ctx = await requireContext(classId);
  if ("error" in ctx) return ctx.error;
  const { srv, institutionId, cls } = ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length > 200) {
      return NextResponse.json({ error: "too_many_updates" }, { status: 400 });
    }
    if (!updates.length) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const requestedAcademicYear = clean(body?.academic_year);
    const academicYear = await resolveAcademicYear(
      srv,
      institutionId,
      (cls as any).academic_year,
      requestedAcademicYear,
    );
    if (!academicYear) {
      return NextResponse.json(
        {
          error:
            "Année scolaire introuvable pour enregistrer le statut boursier.",
        },
        { status: 409 },
      );
    }

    const requestedIds = Array.from(
      new Set(updates.map((row: any) => clean(row?.student_id)).filter(Boolean)),
    );

    const { data: enrollments, error: enrollmentError } = await srv
      .from("class_enrollments")
      .select("student_id")
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .is("end_date", null)
      .in("student_id", requestedIds);
    if (enrollmentError) throw new Error(enrollmentError.message);

    const allowed = new Set(
      (enrollments || []).map((row: any) => clean(row.student_id)),
    );
    const safeUpdates = updates
      .map((row: any) => {
        const studentId = clean(row?.student_id);
        if (!studentId || !allowed.has(studentId)) return null;
        return {
          studentId,
          scholarshipStatus: normalizeStatus(row?.scholarship_status),
        };
      })
      .filter(Boolean) as Array<{
      studentId: string;
      scholarshipStatus: ScholarshipStatus;
    }>;

    if (!safeUpdates.length) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const safeIds = safeUpdates.map((row) => row.studentId);
    const [{ data: existing, error: existingError }, { data: students, error: studentsError }] =
      await Promise.all([
        srv
          .from("student_year_profiles")
          .select("id,student_id")
          .eq("institution_id", institutionId)
          .eq("academic_year_id", academicYear.id)
          .in("student_id", safeIds),
        srv
          .from("students")
          .select("id,is_boarder,is_affecte")
          .eq("institution_id", institutionId)
          .in("id", safeIds),
      ]);

    if (existingError) throw new Error(existingError.message);
    if (studentsError) throw new Error(studentsError.message);

    const existingByStudent = new Map(
      (existing || []).map((row: any) => [clean(row.student_id), clean(row.id)]),
    );
    const studentById = new Map(
      (students || []).map((row: any) => [clean(row.id), row]),
    );

    let updated = 0;
    const now = new Date().toISOString();

    for (const row of safeUpdates) {
      const existingId = existingByStudent.get(row.studentId);
      if (existingId) {
        const { error } = await srv
          .from("student_year_profiles")
          .update({
            scholarship_status: row.scholarshipStatus,
            class_id: classId,
            level: clean((cls as any).level) || "unknown",
            updated_at: now,
          })
          .eq("id", existingId)
          .eq("institution_id", institutionId);
        if (error) throw new Error(error.message);
        updated++;
        continue;
      }

      const student = studentById.get(row.studentId) as any;
      const isBoarder =
        typeof student?.is_boarder === "boolean" ? student.is_boarder : false;
      const isAffecte =
        typeof student?.is_affecte === "boolean" ? student.is_affecte : null;
      const affectationStatus =
        isAffecte === true
          ? "affecte"
          : isAffecte === false
            ? "non_affecte"
            : "unknown";

      const { error } = await srv.from("student_year_profiles").insert({
        institution_id: institutionId,
        academic_year_id: academicYear.id,
        academic_year: academicYear.code,
        student_id: row.studentId,
        class_id: classId,
        level: clean((cls as any).level) || "unknown",
        is_boarder: isBoarder,
        affectation_status: affectationStatus,
        billing_affectation_group: affectationStatus,
        scholarship_status: row.scholarshipStatus,
        source: "manual",
        source_payload: {},
        updated_at: now,
      } as any);
      if (error) throw new Error(error.message);
      updated++;
    }

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "scholarship_update_failed",
      },
      { status: 400 },
    );
  }
}
