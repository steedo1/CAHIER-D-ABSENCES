// src/app/api/admin/classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { isEducationType } from "@/lib/education-organization";
import { dedupeEquivalentGeneralSecondaryClasses } from "@/lib/general-secondary-class-equivalence";

const READ_ALLOWED_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "educator",
  "infirmier",
]);

async function getCurrentAcademicYear(
  institutionId: string,
): Promise<string | null> {
  const srv = getSupabaseServiceClient();

  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current?.code) return String(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? String(latest.code) : null;
}

function roleMatchesInstitution(role: string, roleInstitutionId: unknown, institutionId: string) {
  if (role === "super_admin") return true;

  const roleInst = String(roleInstitutionId || "").trim();
  // Certaines anciennes lignes user_roles n'ont pas institution_id.
  // Dans ce cas, on limite quand même la lecture à l'établissement du profil connecté.
  if (!roleInst) return Boolean(institutionId);

  return roleInst === institutionId;
}

function isGeneralSecondaryClassRow(row: any) {
  const educationType = String(row?.education_type || "").trim();
  const formationCode = String(row?.formation_code || "").trim();
  return (
    (!educationType || educationType === "general_secondary") &&
    !formationCode
  );
}

function dedupeGeneralSecondaryAliasesByAcademicYear(rows: any[]) {
  const preferredIds = new Set<string>();
  const byAcademicYear = new Map<string, any[]>();

  for (const row of rows) {
    if (!isGeneralSecondaryClassRow(row)) continue;
    const academicYear = String(row?.academic_year || "").trim();
    const group = byAcademicYear.get(academicYear) || [];
    group.push(row);
    byAcademicYear.set(academicYear, group);
  }

  for (const group of byAcademicYear.values()) {
    for (const row of dedupeEquivalentGeneralSecondaryClasses(group)) {
      if (row?.id) preferredIds.add(String(row.id));
    }
  }

  // La requête est déjà triée : filtrer conserve donc l'ordre stable de l'API.
  return rows.filter(
    (row) => !isGeneralSecondaryClassRow(row) || preferredIds.has(String(row.id)),
  );
}

async function requireReadableInstitution() {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    return { error: NextResponse.json({ error: roleErr.message }, { status: 400 }) };
  }

  const allowedRows = (roleRows || []).filter((row: any) =>
    READ_ALLOWED_ROLES.has(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = allowedRows.find((row: any) => row.institution_id)?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  if (!institutionId) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  const canRead = allowedRows.some((row: any) =>
    roleMatchesInstitution(String(row.role || ""), row.institution_id, institutionId),
  );

  if (!canRead) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { srv, institutionId };
}

export async function GET(req: NextRequest) {
  const ctx = await requireReadableInstitution();
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const academicYearParam = (
    url.searchParams.get("academic_year") || ""
  ).trim();
  const educationTypeParam = String(
    url.searchParams.get("education_type") || "",
  ).trim();
  const formationCodeParam = String(
    url.searchParams.get("formation_code") || "",
  ).trim();
  const levelCodeParam = String(
    url.searchParams.get("formation_level_code") ||
      url.searchParams.get("level_code") ||
      "",
  ).trim();
  const classIdParam = String(
    url.searchParams.get("class_id") || url.searchParams.get("classId") || "",
  ).trim();

  if (
    educationTypeParam &&
    educationTypeParam !== "all" &&
    !isEducationType(educationTypeParam)
  ) {
    return NextResponse.json(
      { error: "bad_education_type" },
      { status: 400 },
    );
  }

  if (
    formationCodeParam &&
    (!educationTypeParam ||
      educationTypeParam === "all" ||
      educationTypeParam === "general_secondary")
  ) {
    return NextResponse.json(
      { error: "formation_requires_non_general_education_type" },
      { status: 400 },
    );
  }

  if (levelCodeParam && (!educationTypeParam || educationTypeParam === "all")) {
    return NextResponse.json(
      { error: "level_requires_education_type" },
      { status: 400 },
    );
  }

  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 999;
  }

  const academicYear =
    academicYearParam || (await getCurrentAcademicYear(institutionId));
  const shouldFilterYear = Boolean(academicYear && academicYear !== "all");

  let query = srv
    .from("classes")
    .select(
      "id,label,level,code,academic_year,official_track_code,education_type,formation_code,formation_level_code,class_phone_e164,device_phone_e164,class_login_identifier",
    )
    .eq("institution_id", institutionId);

  // Cohérence année scolaire : par défaut on affiche l'année scolaire active.
  // Pour consulter toutes les anciennes classes, appeler explicitement academic_year=all.
  if (shouldFilterYear) {
    query = query.eq("academic_year", academicYear);
  }

  if (classIdParam) {
    query = query.eq("id", classIdParam);
  }

  if (educationTypeParam === "general_secondary") {
    // Compatibilite des anciennes classes creees avant l'ajout de
    // education_type : un contexte absent represente le secondaire general.
    query = query.or(
      "education_type.eq.general_secondary,education_type.is.null",
    );
  } else if (
    educationTypeParam &&
    educationTypeParam !== "all" &&
    isEducationType(educationTypeParam)
  ) {
    query = query.eq("education_type", educationTypeParam);
  }

  if (formationCodeParam) {
    query = query.eq("formation_code", formationCodeParam);
  }

  if (levelCodeParam) {
    query =
      educationTypeParam === "general_secondary"
        ? query.eq("level", levelCodeParam)
        : query.eq("formation_level_code", levelCodeParam);
  }

  const { data, error } = await query
    .order("level", { ascending: true })
    .order("label", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const sourceRows = (data ?? []) as any[];
  const visibleRows = classIdParam
    ? sourceRows
    : dedupeGeneralSecondaryAliasesByAcademicYear(sourceRows);

  const items = visibleRows.map((c: any) => ({
    id: c.id,
    name: c.label,
    label: c.label,
    level: c.level,
    code: c.code,
    academic_year: c.academic_year,
    official_track_code: c.official_track_code,
    officialTrackCode: c.official_track_code,
    education_type: c.education_type ?? null,
    formation_code: c.formation_code ?? null,
    formation_level_code: c.formation_level_code ?? null,
    class_login_identifier:
      c.class_login_identifier ?? c.class_phone_e164 ?? null,
    device_phone_e164: c.device_phone_e164 ?? null,
    // Compatibilité des anciens écrans pendant la transition.
    class_phone_e164: c.class_phone_e164 ?? null,
  }));

  return NextResponse.json({
    items,
    academic_year: shouldFilterYear ? academicYear : null,
    scope: {
      education_type: educationTypeParam || null,
      formation_code: formationCodeParam || null,
      formation_level_code: levelCodeParam || null,
      class_id: classIdParam || null,
    },
  });
}
