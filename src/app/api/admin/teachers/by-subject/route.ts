// src/app/api/admin/teachers/by-subject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { isEducationType } from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  readEducationScopeFromSearchParams,
  type EducationScopeValue,
} from "@/lib/education-scope";
import { resolveTeacherPoolInstitutionIds } from "@/lib/teacher-pool-scope";

/** Helper: exécute une requête Supabase et retourne data ou null. */
async function trySelect<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
): Promise<T | null> {
  try {
    const { data, error } = await fn();
    if (error) return null;
    return (data ?? null) as T;
  } catch {
    return null;
  }
}

const SCOPE_PARAMS = [
  "education_type",
  "formation_code",
  "formation_level_code",
  "level_code",
  "class_id",
  "classId",
] as const;

function readValidatedScope(params: URLSearchParams):
  | { ok: true; scope: EducationScopeValue; active: boolean }
  | { ok: false; error: string } {
  const active = SCOPE_PARAMS.some((name) => params.has(name));
  const rawType = String(params.get("education_type") || "").trim();

  if (
    rawType &&
    rawType !== ALL_EDUCATION_TYPES &&
    !isEducationType(rawType)
  ) {
    return { ok: false, error: "bad_education_type" };
  }

  const scope = active
    ? readEducationScopeFromSearchParams(params)
    : {
        educationType: ALL_EDUCATION_TYPES,
        formationCode: "",
        levelCode: "",
        classId: "",
      };

  if (
    scope.formationCode &&
    (scope.educationType === ALL_EDUCATION_TYPES ||
      scope.educationType === "general_secondary")
  ) {
    return {
      ok: false,
      error: "formation_requires_non_general_education_type",
    };
  }

  if (scope.levelCode && scope.educationType === ALL_EDUCATION_TYPES) {
    return { ok: false, error: "level_requires_education_type" };
  }

  return { ok: true, scope, active };
}

async function resolveScopedClassIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  scope: EducationScopeValue,
  scopeParamsPresent: boolean,
): Promise<string[] | null> {
  const hasRestriction =
    scopeParamsPresent &&
    (scope.educationType !== ALL_EDUCATION_TYPES ||
      Boolean(scope.formationCode) ||
      Boolean(scope.levelCode) ||
      Boolean(scope.classId));

  if (!hasRestriction) return null;

  let query = srv
    .from("classes")
    .select("id")
    .eq("institution_id", institutionId);

  if (scope.classId) query = query.eq("id", scope.classId);

  if (scope.educationType === "general_secondary") {
    query = query.or(
      "education_type.eq.general_secondary,education_type.is.null",
    );
  } else if (scope.educationType !== ALL_EDUCATION_TYPES) {
    query = query.eq("education_type", scope.educationType);
  }

  if (scope.formationCode) {
    query = query.eq("formation_code", scope.formationCode);
  }

  if (scope.levelCode) {
    query =
      scope.educationType === "general_secondary"
        ? query.eq("level", scope.levelCode)
        : query.eq("formation_level_code", scope.levelCode);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return Array.from(
    new Set((data || []).map((row: any) => String(row.id)).filter(Boolean)),
  );
}

async function resolveSubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  poolInstitutionIds: string[],
  subjectId: string,
) {
  const ids = new Set<string>([subjectId]);

  const { data } = await srv
    .from("institution_subjects")
    .select("id")
    .in("institution_id", poolInstitutionIds)
    .eq("subject_id", subjectId);

  for (const row of data || []) ids.add(String(row.id));
  return Array.from(ids);
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const subjectId = String(url.searchParams.get("subject_id") || "").trim();
  const scopeResult = readValidatedScope(url.searchParams);
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 });
  }

  const profCtx = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profCtx.error) {
    return NextResponse.json({ error: profCtx.error.message }, { status: 400 });
  }

  const institutionId = String(profCtx.data?.institution_id || "").trim();
  if (!institutionId) {
    return NextResponse.json(
      { error: "no_institution", items: [] },
      { status: 400 },
    );
  }

  const adminCheck = await srv
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (adminCheck.error) {
    return NextResponse.json(
      { error: adminCheck.error.message },
      { status: 400 },
    );
  }

  if (!adminCheck.data) {
    return NextResponse.json({ error: "forbidden", items: [] }, { status: 403 });
  }

  let poolInstitutionIds: string[];
  try {
    poolInstitutionIds = await resolveTeacherPoolInstitutionIds(srv, institutionId);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "teacher_pool_scope_failed", items: [] },
      { status: 400 },
    );
  }

  const roles = await srv
    .from("user_roles")
    .select("profile_id")
    .in("institution_id", poolInstitutionIds)
    .eq("role", "teacher");

  if (roles.error) {
    return NextResponse.json({ error: roles.error.message }, { status: 400 });
  }

  let teacherIds = new Set<string>(
    (roles.data || []).map((row: any) => String(row.profile_id)),
  );

  if (!teacherIds.size) {
    return NextResponse.json({
      items: [],
      meta: {
        shared_pool: poolInstitutionIds.length > 1,
        institution_count: poolInstitutionIds.length,
      },
    });
  }

  const scopedClassIds = await resolveScopedClassIds(
    srv,
    institutionId,
    scopeResult.scope,
    scopeResult.active,
  );
  const classScopeActive = scopedClassIds !== null;
  const allowedSubjectIds = subjectId
    ? await resolveSubjectIds(srv, poolInstitutionIds, subjectId)
    : [];

  if (classScopeActive) {
    if (!scopedClassIds?.length) {
      return NextResponse.json({
        items: [],
        meta: {
          shared_pool: poolInstitutionIds.length > 1,
          institution_count: poolInstitutionIds.length,
        },
      });
    }

    let serviceRows = await trySelect<any[]>(async () => {
      let query = srv
        .from("class_teachers")
        .select("teacher_id,subject_id,class_id")
        .eq("institution_id", institutionId)
        .in("class_id", scopedClassIds);
      if (subjectId) query = query.in("subject_id", allowedSubjectIds);
      return await query;
    });

    if (!Array.isArray(serviceRows)) {
      serviceRows = await trySelect<any[]>(async () => {
        let query = srv
          .from("teacher_timetables")
          .select("teacher_id,subject_id,class_id")
          .eq("institution_id", institutionId)
          .in("class_id", scopedClassIds);
        if (subjectId) query = query.in("subject_id", allowedSubjectIds);
        return await query;
      });
    }

    const allowedTeachers = new Set(
      (serviceRows || [])
        .map((row: any) => String(row.teacher_id || ""))
        .filter(Boolean),
    );
    teacherIds = new Set(
      Array.from(teacherIds).filter((id) => allowedTeachers.has(id)),
    );
  } else if (subjectId) {
    const [subjectRows, assignmentRows] = await Promise.all([
      trySelect<any[]>(async () =>
        await srv
          .from("teacher_subjects")
          .select("profile_id")
          .in("institution_id", poolInstitutionIds)
          .in("subject_id", allowedSubjectIds),
      ),
      trySelect<any[]>(async () =>
        await srv
          .from("class_teachers")
          .select("teacher_id")
          .in("institution_id", poolInstitutionIds)
          .in("subject_id", allowedSubjectIds),
      ),
    ]);

    const allowedTeachers = new Set<string>();
    for (const row of subjectRows || []) {
      const id = String(row.profile_id || "").trim();
      if (id) allowedTeachers.add(id);
    }
    for (const row of assignmentRows || []) {
      const id = String(row.teacher_id || "").trim();
      if (id) allowedTeachers.add(id);
    }

    if (Array.isArray(subjectRows) || Array.isArray(assignmentRows)) {
      teacherIds = new Set(
        Array.from(teacherIds).filter((id) => allowedTeachers.has(id)),
      );
    }
  }

  if (!teacherIds.size) {
    return NextResponse.json({
      items: [],
      meta: {
        shared_pool: poolInstitutionIds.length > 1,
        institution_count: poolInstitutionIds.length,
      },
    });
  }

  const profiles = await srv
    .from("profiles")
    .select("id, display_name, email, phone")
    .in("id", Array.from(teacherIds))
    .order("display_name", { ascending: true });

  if (profiles.error) {
    return NextResponse.json(
      { error: profiles.error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    items: (profiles.data || []).map((profile: any) => ({
      id: String(profile.id),
      display_name: profile.display_name ?? null,
      email: profile.email ?? null,
      phone: profile.phone ?? null,
    })),
    meta: {
      shared_pool: poolInstitutionIds.length > 1,
      institution_count: poolInstitutionIds.length,
    },
  });
}
