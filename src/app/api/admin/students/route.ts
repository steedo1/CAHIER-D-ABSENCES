// src/app/api/admin/students/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ALLOWED_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "educator",
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
  if (!roleInst) return Boolean(institutionId);

  return roleInst === institutionId;
}

async function requireReadableInstitution() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
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

  const { srv, institutionId: inst } = ctx;

  const url = new URL(req.url);
  const classId = String(
    url.searchParams.get("class_id") || url.searchParams.get("classId") || "",
  ).trim();
  const academicYearParam = String(
    url.searchParams.get("academic_year") || "",
  ).trim();
  const academicYear =
    academicYearParam || (await getCurrentAcademicYear(inst));
  const shouldFilterYear = Boolean(academicYear && academicYear !== "all");

  let query = srv
    .from("class_enrollments")
    .select(
      `
      student_id,
      class_id,
      students:student_id (
        id,
        first_name,
        last_name,
        full_name,
        matricule,
        institution_id,
        photo_url,
        birthdate,
        birth_place,
        nationality,
        gender,
        regime,
        is_repeater,
        is_affecte,
        is_boarder
      ),
      classes:class_id!inner ( id, label, level, institution_id, academic_year )
    `,
    )
    .eq("institution_id", inst)
    .is("end_date", null);

  if (classId) query = query.eq("class_id", classId);
  if (shouldFilterYear) query = query.eq("classes.academic_year", academicYear);

  const { data, error } = await query.limit(50000);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const seen = new Set<string>();
  const items: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string;
    matricule: string | null;
    class_id: string;
    class_label: string | null;
    class_level: string | null;
    academic_year: string | null;
    photo_url: string | null;
    birthdate: string | null;
    birth_date: string | null;
    birth_place: string | null;
    nationality: string | null;
    gender: string | null;
    is_repeater: boolean | null;
    is_affecte: boolean | null;
    is_boarder: boolean | null;
    regime: string | null;
  }> = [];

  for (const row of data ?? []) {
    const s = (row as any).students ?? {};
    const c = (row as any).classes ?? {};
    const sid = s.id as string | undefined;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);

    const full =
      `${s.last_name ?? ""} ${s.first_name ?? ""}`.trim() ||
      String(s.full_name || "").trim() ||
      "—";

    items.push({
      id: sid,
      first_name: (s.first_name ?? null) as string | null,
      last_name: (s.last_name ?? null) as string | null,
      full_name: full,
      matricule: (s.matricule ?? null) as string | null,
      class_id: (row as any).class_id as string,
      class_label: (c.label ?? null) as string | null,
      class_level: (c.level ?? null) as string | null,
      academic_year: (c.academic_year ?? null) as string | null,
      photo_url: (s.photo_url ?? null) as string | null,
      birthdate: (s.birthdate ?? null) as string | null,
      birth_date: (s.birthdate ?? null) as string | null,
      birth_place: (s.birth_place ?? null) as string | null,
      nationality: (s.nationality ?? null) as string | null,
      gender: (s.gender ?? null) as string | null,
      is_repeater:
        typeof s.is_repeater === "boolean" ? (s.is_repeater as boolean) : null,
      is_affecte:
        typeof s.is_affecte === "boolean" ? (s.is_affecte as boolean) : null,
      is_boarder:
        typeof s.is_boarder === "boolean" ? (s.is_boarder as boolean) : null,
      regime: (s.regime ?? null) as string | null,
    });
  }

  return NextResponse.json({
    items,
    academic_year: shouldFilterYear ? academicYear : null,
  });
}
