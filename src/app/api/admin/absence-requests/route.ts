import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { isEducationType } from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  classMatchesEducationScope,
  readEducationScopeFromRecord,
  readEducationScopeFromSearchParams,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
type ActionKind = "approve" | "reject";

type AdminAbsenceRequestItem = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  teacher_name: string | null;
  start_date: string;
  end_date: string;
  reason_code: string;
  reason_label: string;
  details: string;
  requested_days: number;
  signed: boolean;
  source: string;
  status: RequestStatus;
  admin_comment: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at: string | null;
  lost_hours_total: number;
  lost_sessions_total: number;
  impact_summary: unknown;
  makeup_plan: unknown;
};

type TeacherOption = {
  id: string;
  name: string;
};

type RequestCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
};

const ALL_SCOPE: EducationScopeValue = {
  educationType: ALL_EDUCATION_TYPES,
  formationCode: "",
  levelCode: "",
  classId: "",
};

async function getAdminContext() {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user) {
    return { ok: false as const, status: 401, error: "Non authentifié." };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr || !me?.institution_id) {
    return {
      ok: false as const,
      status: 400,
      error: "Aucune institution associée.",
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", me.institution_id)
    .maybeSingle();

  if (roleErr) {
    return { ok: false as const, status: 400, error: roleErr.message };
  }

  const role = String(roleRow?.role || "");
  if (!["admin", "super_admin"].includes(role)) {
    return { ok: false as const, status: 403, error: "Droits insuffisants." };
  }

  return {
    ok: true as const,
    admin_user_id: String(user.id),
    institution_id: String(me.institution_id),
  };
}

const SELECT_COLUMNS = `
  id,
  institution_id,
  teacher_user_id,
  teacher_profile_id,
  start_date,
  end_date,
  reason_code,
  reason_label,
  details,
  requested_days,
  signed,
  source,
  status,
  admin_comment,
  approved_at,
  approved_by,
  rejected_at,
  rejected_by,
  created_at,
  updated_at,
  lost_hours_total,
  lost_sessions_total,
  impact_summary,
  makeup_plan
`;

function hasScopeFields(input: Record<string, unknown> | null | undefined) {
  return Boolean(
    input &&
      (input.education_type != null ||
        input.formation_code != null ||
        input.formation_level_code != null ||
        input.level_code != null ||
        input.class_id != null ||
        input.classId != null),
  );
}

function getScopeFromSearchParams(params: URLSearchParams): EducationScopeValue {
  const hasScope =
    params.has("education_type") ||
    params.has("formation_code") ||
    params.has("formation_level_code") ||
    params.has("level_code") ||
    params.has("class_id") ||
    params.has("classId");

  return hasScope ? readEducationScopeFromSearchParams(params) : ALL_SCOPE;
}

function validateRawEducationType(raw: unknown) {
  const value = String(raw || "").trim();
  return (
    !value || value === ALL_EDUCATION_TYPES || isEducationType(value)
  );
}

function extractImpactClassIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];

  const source = raw as Record<string, any>;
  const candidate =
    source.impact_summary ||
    source.impactSummary ||
    source.impact ||
    source.summary ||
    source;

  if (!candidate || typeof candidate !== "object") return [];

  const impacted = Array.isArray(candidate.impacted_classes)
    ? candidate.impacted_classes
    : Array.isArray(candidate.impactedClasses)
      ? candidate.impactedClasses
      : [];

  const ids = new Set<string>();

  for (const row of impacted) {
    const classId = String(row?.class_id || row?.classId || "").trim();
    if (classId) ids.add(classId);

    for (const slot of Array.isArray(row?.slots) ? row.slots : []) {
      const slotClassId = String(
        slot?.class_id || slot?.classId || classId || "",
      ).trim();
      if (slotClassId) ids.add(slotClassId);
    }
  }

  return Array.from(ids);
}

async function hydrateTeacherNames(
  institution_id: string,
  rows: any[],
): Promise<AdminAbsenceRequestItem[]> {
  const srv = getSupabaseServiceClient();

  const ids = Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row.teacher_profile_id || ""))
        .filter(Boolean),
    ),
  );

  if (ids.length === 0) {
    return (rows || []).map((row) => ({
      ...(row as any),
      teacher_name: null,
    }));
  }

  const { data: profiles } = await srv
    .from("profiles")
    .select("id,display_name,email")
    .eq("institution_id", institution_id)
    .in("id", ids);

  const nameById = new Map<string, string>();
  (profiles || []).forEach((profile: any) => {
    nameById.set(
      String(profile.id),
      String(profile.display_name || profile.email || ""),
    );
  });

  return (rows || []).map((row) => ({
    ...(row as any),
    teacher_name: nameById.get(String(row.teacher_profile_id)) || null,
  }));
}

async function filterItemsByEducationScope(
  institutionId: string,
  rows: AdminAbsenceRequestItem[],
  scope: EducationScopeValue,
): Promise<AdminAbsenceRequestItem[]> {
  if (
    scope.educationType === ALL_EDUCATION_TYPES &&
    !scope.formationCode &&
    !scope.levelCode &&
    !scope.classId
  ) {
    return rows;
  }

  const srv = getSupabaseServiceClient();
  const { data: classRows, error: classError } = await srv
    .from("classes")
    .select(
      "id,label,level,education_type,formation_code,formation_level_code",
    )
    .eq("institution_id", institutionId);

  if (classError) throw new Error(classError.message);

  const scopedClasses = ((classRows || []) as EducationScopedClass[]).filter(
    (row) => classMatchesEducationScope(row, scope),
  );
  const allowedClassIds = new Set(scopedClasses.map((row) => String(row.id)));

  if (!allowedClassIds.size) return [];

  const impactIdsByRequest = new Map<string, string[]>();
  const fallbackTeacherIds = new Set<string>();

  for (const row of rows) {
    const impactIds = extractImpactClassIds(row.impact_summary);
    impactIdsByRequest.set(row.id, impactIds);
    if (!impactIds.length && row.teacher_profile_id) {
      fallbackTeacherIds.add(String(row.teacher_profile_id));
    }
  }

  const classesByTeacher = new Map<string, Set<string>>();
  const teacherIds = Array.from(fallbackTeacherIds);

  if (teacherIds.length) {
    const { data: serviceRows, error: serviceError } = await srv
      .from("class_teachers")
      .select("teacher_id,class_id")
      .eq("institution_id", institutionId)
      .in("teacher_id", teacherIds);

    if (serviceError) throw new Error(serviceError.message);

    for (const service of serviceRows || []) {
      const teacherId = String(service.teacher_id || "");
      const classId = String(service.class_id || "");
      if (!teacherId || !classId) continue;
      const set = classesByTeacher.get(teacherId) || new Set<string>();
      set.add(classId);
      classesByTeacher.set(teacherId, set);
    }
  }

  return rows.filter((row) => {
    const impactIds = impactIdsByRequest.get(row.id) || [];
    if (impactIds.length) {
      return impactIds.some((classId) => allowedClassIds.has(classId));
    }

    const teacherClasses = classesByTeacher.get(String(row.teacher_profile_id));
    if (!teacherClasses) return false;
    return Array.from(teacherClasses).some((classId) =>
      allowedClassIds.has(classId),
    );
  });
}

function buildTeacherOptions(rows: AdminAbsenceRequestItem[]): TeacherOption[] {
  const map = new Map<string, string>();

  for (const row of rows) {
    const id = String(row.teacher_profile_id || "").trim();
    if (!id) continue;
    const name = String(row.teacher_name || "Enseignant non identifié").trim();
    map.set(id, name || "Enseignant non identifié");
  }

  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, "fr", {
        sensitivity: "base",
      }),
    );
}

function countStatuses(rows: AdminAbsenceRequestItem[]): RequestCounts {
  return rows.reduce<RequestCounts>(
    (counts, row) => {
      counts.total += 1;
      counts[row.status] += 1;
      return counts;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    },
  );
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  const srv = getSupabaseServiceClient();
  const url = new URL(req.url);
  const status = String(url.searchParams.get("status") || "").trim();
  const teacherProfileId = String(
    url.searchParams.get("teacher_profile_id") || "",
  ).trim();
  const teacherQuery = String(url.searchParams.get("teacher") || "")
    .trim()
    .toLowerCase();
  const rawEducationType = url.searchParams.get("education_type");

  if (!validateRawEducationType(rawEducationType)) {
    return NextResponse.json(
      { ok: false, error: "Type d’enseignement invalide." },
      { status: 400 },
    );
  }

  const educationScope = getScopeFromSearchParams(url.searchParams);

  const { data, error } = await srv
    .from("teacher_absence_requests")
    .select(SELECT_COLUMNS)
    .eq("institution_id", ctx.institution_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  try {
    const hydrated = await hydrateTeacherNames(ctx.institution_id, data || []);
    const scopedItems = await filterItemsByEducationScope(
      ctx.institution_id,
      hydrated,
      educationScope,
    );
    const teachers = buildTeacherOptions(scopedItems);

    let teacherScopedItems = scopedItems;
    if (teacherProfileId) {
      teacherScopedItems = teacherScopedItems.filter(
        (item) => item.teacher_profile_id === teacherProfileId,
      );
    }
    if (teacherQuery) {
      teacherScopedItems = teacherScopedItems.filter((item) =>
        String(item.teacher_name || "").toLowerCase().includes(teacherQuery),
      );
    }

    const counts = countStatuses(teacherScopedItems);
    const items =
      status && status !== "all"
        ? teacherScopedItems.filter((item) => item.status === status)
        : teacherScopedItems;

    return NextResponse.json({
      ok: true,
      items,
      teachers,
      counts,
    });
  } catch (scopeError: any) {
    return NextResponse.json(
      {
        ok: false,
        error:
          scopeError?.message ||
          "Impossible d’appliquer le périmètre pédagogique.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  const srv = getSupabaseServiceClient();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload JSON invalide." },
      { status: 400 },
    );
  }

  const id = String(body?.id || "").trim();
  const action = String(body?.action || "").trim() as ActionKind;
  const admin_comment = String(body?.admin_comment || "").trim() || null;

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Identifiant de demande manquant." },
      { status: 400 },
    );
  }

  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "Action invalide." },
      { status: 400 },
    );
  }

  const { data: currentData, error: currentError } = await srv
    .from("teacher_absence_requests")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .eq("institution_id", ctx.institution_id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json(
      { ok: false, error: currentError.message },
      { status: 400 },
    );
  }

  if (!currentData) {
    return NextResponse.json(
      { ok: false, error: "Demande introuvable." },
      { status: 404 },
    );
  }

  if (String(currentData.status) !== "pending") {
    return NextResponse.json(
      {
        ok: false,
        error: "Cette demande a déjà été traitée ou annulée.",
      },
      { status: 409 },
    );
  }

  const rawScope =
    body?.education_scope && typeof body.education_scope === "object"
      ? body.education_scope
      : body;

  if (hasScopeFields(rawScope)) {
    if (!validateRawEducationType(rawScope?.education_type)) {
      return NextResponse.json(
        { ok: false, error: "Type d’enseignement invalide." },
        { status: 400 },
      );
    }

    const scope = readEducationScopeFromRecord(rawScope);
    const [hydratedCurrent] = await hydrateTeacherNames(ctx.institution_id, [
      currentData,
    ]);

    try {
      const matching = await filterItemsByEducationScope(
        ctx.institution_id,
        [hydratedCurrent],
        scope,
      );

      if (!matching.length) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "La demande ne correspond plus au périmètre pédagogique sélectionné.",
          },
          { status: 409 },
        );
      }
    } catch (scopeError: any) {
      return NextResponse.json(
        {
          ok: false,
          error:
            scopeError?.message ||
            "Impossible de vérifier le périmètre pédagogique.",
        },
        { status: 400 },
      );
    }
  }

  const nowIso = new Date().toISOString();
  const patch =
    action === "approve"
      ? {
          status: "approved",
          admin_comment,
          approved_at: nowIso,
          approved_by: ctx.admin_user_id,
          rejected_at: null,
          rejected_by: null,
        }
      : {
          status: "rejected",
          admin_comment,
          approved_at: null,
          approved_by: null,
          rejected_at: nowIso,
          rejected_by: ctx.admin_user_id,
        };

  const { data, error } = await srv
    .from("teacher_absence_requests")
    .update(patch)
    .eq("id", id)
    .eq("institution_id", ctx.institution_id)
    .eq("status", "pending")
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        ok: false,
        error: "La demande a été modifiée entre-temps. Actualisez la page.",
      },
      { status: 409 },
    );
  }

  const [item] = await hydrateTeacherNames(ctx.institution_id, [data]);

  return NextResponse.json({
    ok: true,
    item,
    message:
      action === "approve"
        ? "La demande a été approuvée."
        : "La demande a été rejetée.",
  });
}
