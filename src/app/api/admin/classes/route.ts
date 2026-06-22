// src/app/api/admin/classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

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
      "id,label,level,code,academic_year,official_track_code,class_phone_e164",
    )
    .eq("institution_id", institutionId);

  // Cohérence année scolaire : par défaut on affiche l'année scolaire active.
  // Pour consulter toutes les anciennes classes, appeler explicitement academic_year=all.
  if (shouldFilterYear) {
    query = query.eq("academic_year", academicYear);
  }

  const { data, error } = await query
    .order("level", { ascending: true })
    .order("label", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const items = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.label,
    label: c.label,
    level: c.level,
    code: c.code,
    academic_year: c.academic_year,
    official_track_code: c.official_track_code,
    officialTrackCode: c.official_track_code,
    class_phone_e164: c.class_phone_e164 ?? null,
  }));

  return NextResponse.json({
    items,
    academic_year: shouldFilterYear ? academicYear : null,
  });
}
