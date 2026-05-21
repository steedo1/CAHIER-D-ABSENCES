// src/app/api/admin/classes/[id]/roster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileMini = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

type RosterDetail = {
  student_id: string;
  gender: string | null;
  birthdate: string | null;
  birth_place: string | null;
  nationality: string | null;
  is_repeater: boolean | null;
  lv2: string | null;
};

function fullName(row: any) {
  const direct = String(row?.full_name || "").trim();
  if (direct) return direct;

  return [row?.last_name, row?.first_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNullableText(value: unknown) {
  const s = cleanText(value);
  return s ? s : null;
}

function normalizeDateYmd(value: unknown) {
  const s = cleanText(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.replace(/\./g, "/").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function normalizeGender(value: unknown) {
  const s = cleanText(value).toLowerCase();
  if (!s) return null;
  if (s.startsWith("f")) return "F";
  if (s.startsWith("m") || s.startsWith("h") || s.startsWith("g")) return "M";
  return cleanText(value).slice(0, 8).toUpperCase();
}

function normalizeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const s = cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!s) return null;
  if (["oui", "yes", "y", "1", "true", "vrai", "r", "x"].includes(s)) return true;
  if (["non", "no", "0", "false", "faux", "n"].includes(s)) return false;
  return null;
}

async function getCurrentAcademicYear(institutionId: string): Promise<string | null> {
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

async function getProfileById(id: string | null): Promise<ProfileMini | null> {
  if (!id) return null;

  const srv = getSupabaseServiceClient();
  const { data } = await srv
    .from("profiles")
    .select("id,display_name,email,phone")
    .eq("id", id)
    .maybeSingle();

  if (!data?.id) return null;

  return {
    id: String(data.id),
    display_name: data.display_name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
  };
}

async function loadEducatorProfiles(ids: string[]): Promise<ProfileMini[]> {
  if (!ids.length) return [];

  const srv = getSupabaseServiceClient();
  const { data: profiles } = await srv
    .from("profiles")
    .select("id,display_name,email,phone")
    .in("id", ids);

  return (profiles || [])
    .map((row: any) => ({
      id: String(row.id),
      display_name: row.display_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
    }))
    .sort((a, b) =>
      String(a.display_name || a.email || a.phone || "").localeCompare(
        String(b.display_name || b.email || b.phone || ""),
        "fr",
        { sensitivity: "base" },
      ),
    );
}

async function getEducators(
  institutionId: string,
  classId: string,
  classLevel: string | null | undefined,
): Promise<ProfileMini[]> {
  const srv = getSupabaseServiceClient();

  const { data: roles } = await srv
    .from("user_roles")
    .select("profile_id,role")
    .eq("institution_id", institutionId)
    .eq("role", "educator");

  const allEducatorIds = Array.from(
    new Set<string>((roles || []).map((row: any) => String(row.profile_id || "").trim()).filter(Boolean)),
  );

  if (!allEducatorIds.length) return [];

  const { data: assignments, error: assignErr } = await srv
    .from("educator_class_assignments")
    .select("profile_id,level,class_id")
    .eq("institution_id", institutionId)
    .in("profile_id", allEducatorIds);

  // Compatibilité : si la table n’existe pas encore, on affiche tous les éducateurs.
  if (assignErr) return loadEducatorProfiles(allEducatorIds);

  const rows = Array.isArray(assignments) ? assignments : [];
  if (rows.length === 0) return loadEducatorProfiles(allEducatorIds);

  const level = String(classLevel || "").trim();
  const matchingIds = Array.from(
    new Set<string>(
      rows
        .filter((row: any) => {
          const rowClassId = String(row.class_id || "").trim();
          const rowLevel = String(row.level || "").trim();
          if (rowClassId) return rowClassId === classId;
          return !!level && rowLevel === level;
        })
        .map((row: any) => String(row.profile_id || ""))
        .filter(Boolean),
    ),
  );

  return loadEducatorProfiles(matchingIds);
}

async function requireAdminContext(classId: string) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Important : dans cette base, le rôle n’est pas dans profiles.
  // La source fiable des rôles est public.user_roles.
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) return { error: NextResponse.json({ error: roleErr.message }, { status: 400 }) };

  const adminRoles = (roleRows || []).filter((row: any) =>
    ["admin", "super_admin"].includes(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = adminRoles.find((row: any) => row.institution_id)?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  const isAdmin = adminRoles.length > 0;

  if (!institutionId) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  if (!isAdmin) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const { data: cls, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,head_teacher_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) return { error: NextResponse.json({ error: classErr.message }, { status: 400 }) };
  if (!cls) return { error: NextResponse.json({ error: "class_not_found" }, { status: 404 }) };

  return { supa, srv, user, me, institutionId, cls };
}

async function loadRosterDetails(institutionId: string, studentIds: string[]) {
  const srv = getSupabaseServiceClient();
  const map = new Map<string, RosterDetail>();

  if (!studentIds.length) return map;

  const { data, error } = await srv
    .from("student_roster_details")
    .select("student_id,gender,birthdate,birth_place,nationality,is_repeater,lv2")
    .eq("institution_id", institutionId)
    .in("student_id", studentIds);

  // Compatibilité : si la migration n’a pas encore été exécutée, la liste reste imprimable.
  if (error) return map;

  for (const row of data || []) {
    const sid = String((row as any).student_id || "").trim();
    if (!sid) continue;
    map.set(sid, {
      student_id: sid,
      gender: (row as any).gender ?? null,
      birthdate: (row as any).birthdate ?? null,
      birth_place: (row as any).birth_place ?? null,
      nationality: (row as any).nationality ?? null,
      is_repeater:
        typeof (row as any).is_repeater === "boolean" ? (row as any).is_repeater : null,
      lv2: (row as any).lv2 ?? null,
    });
  }

  return map;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();

  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId);
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, cls } = ctx;

  const url = new URL(req.url);
  const academicYearParam = String(url.searchParams.get("academic_year") || "").trim();
  const academicYear = academicYearParam || (await getCurrentAcademicYear(institutionId));

  if (academicYear && academicYear !== "all" && String((cls as any).academic_year || "") !== academicYear) {
    return NextResponse.json({ error: "class_not_in_academic_year" }, { status: 404 });
  }

  const [institutionRes, academicYearRes, headTeacher, educators] = await Promise.all([
    srv
      .from("institutions")
      .select(
        [
          "id",
          "name",
          "logo_url",
          "phone",
          "email",
          "regional_direction",
          "postal_address",
          "status",
          "head_name",
          "head_title",
          "country_name",
          "country_motto",
          "ministry_name",
          "code",
          "settings_json",
        ].join(","),
      )
      .eq("id", institutionId)
      .maybeSingle(),
    academicYear && academicYear !== "all"
      ? srv
          .from("academic_years")
          .select("code,label,start_date,end_date,is_current")
          .eq("institution_id", institutionId)
          .eq("code", academicYear)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    getProfileById((cls as any).head_teacher_id ? String((cls as any).head_teacher_id) : null),
    getEducators(institutionId, classId, (cls as any).level),
  ]);

  if (institutionRes.error) {
    return NextResponse.json({ error: institutionRes.error.message }, { status: 400 });
  }

  const { data: enrollments, error: enrollErr } = await srv
    .from("class_enrollments")
    .select(
      `
      id,
      student_id,
      start_date,
      end_date,
      students:student_id(
        id,
        first_name,
        last_name,
        full_name,
        matricule,
        gender,
        birthdate,
        birth_place,
        nationality,
        is_repeater
      )
    `,
    )
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null);

  if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 400 });

  const studentIds = (enrollments || [])
    .map((row: any) => String(row.student_id || row.students?.id || "").trim())
    .filter(Boolean);
  const details = await loadRosterDetails(institutionId, studentIds);

  const students = (enrollments || [])
    .map((row: any) => {
      const s = row.students || {};
      const sid = String(s.id || row.student_id || "").trim();
      const detail = details.get(sid);
      const name = fullName(s) || "—";

      return {
        id: sid,
        matricule: s.matricule ? String(s.matricule) : null,
        full_name: name,
        first_name: s.first_name ?? null,
        last_name: s.last_name ?? null,
        gender: detail?.gender ?? s.gender ?? null,
        birthdate: detail?.birthdate ?? s.birthdate ?? null,
        birth_place: detail?.birth_place ?? s.birth_place ?? null,
        nationality: detail?.nationality ?? s.nationality ?? null,
        is_repeater:
          typeof detail?.is_repeater === "boolean"
            ? detail.is_repeater
            : typeof s.is_repeater === "boolean"
              ? s.is_repeater
              : null,
        lv2: detail?.lv2 ?? null,
        enrollment_start_date: row.start_date ?? null,
      };
    })
    .filter((row: any) => row.id)
    .sort((a: any, b: any) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "fr", {
        sensitivity: "base",
        numeric: true,
      }),
    );

  const institution = (institutionRes.data || {}) as Record<string, any>;
  const rawSettings = institution.settings_json;
  const settings =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, any>)
      : {};
  const institutionName =
    cleanText(institution.name) ||
    cleanText(settings.institution_name || settings.school_name || settings.name);

  return NextResponse.json({
    ok: true,
    class: {
      id: String((cls as any).id),
      label: String((cls as any).label || (cls as any).code || "Classe"),
      level: (cls as any).level ?? null,
      code: (cls as any).code ?? null,
      academic_year: (cls as any).academic_year ?? null,
      official_track_code: (cls as any).official_track_code ?? null,
    },
    academic_year: academicYearRes.data
      ? {
          code: academicYearRes.data.code ?? academicYear ?? null,
          label: academicYearRes.data.label ?? academicYear ?? null,
          start_date: academicYearRes.data.start_date ?? null,
          end_date: academicYearRes.data.end_date ?? null,
          is_current: academicYearRes.data.is_current === true,
        }
      : {
          code: academicYear ?? (cls as any).academic_year ?? null,
          label: academicYear ?? (cls as any).academic_year ?? null,
          start_date: null,
          end_date: null,
          is_current: false,
        },
    institution: {
      id: String(institution?.id || institutionId),
      name: institutionName || "Établissement",
      acronym: null,
      logo_url: institution?.logo_url ?? null,
      phone: institution?.phone ?? null,
      email: institution?.email ?? null,
      regional_direction: institution?.regional_direction ?? null,
      postal_address: institution?.postal_address ?? null,
      status: institution?.status ?? null,
      head_name: institution?.head_name ?? null,
      head_title: institution?.head_title ?? null,
      country_name: institution?.country_name ?? null,
      country_motto: institution?.country_motto ?? null,
      ministry_name: institution?.ministry_name ?? null,
      code: institution?.code ?? null,
    },
    staff: {
      head_teacher: headTeacher,
      educators,
    },
    students,
    totals: {
      students: students.length,
      girls: students.filter((s: any) => /^f/i.test(String(s.gender || ""))).length,
      boys: students.filter((s: any) => /^m/i.test(String(s.gender || ""))).length,
    },
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();
  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId);
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body?.updates) ? body.updates : [];

  if (!updates.length) return NextResponse.json({ ok: true, updated: 0 });
  if (updates.length > 200) {
    return NextResponse.json({ error: "too_many_updates" }, { status: 400 });
  }

  const requestedIds = Array.from(
    new Set(updates.map((row: any) => cleanText(row?.student_id)).filter(Boolean)),
  );

  if (!requestedIds.length) return NextResponse.json({ ok: true, updated: 0 });

  const { data: allowedRows, error: allowedErr } = await srv
    .from("class_enrollments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null)
    .in("student_id", requestedIds);

  if (allowedErr) return NextResponse.json({ error: allowedErr.message }, { status: 400 });

  const allowed = new Set((allowedRows || []).map((row: any) => String(row.student_id)));

  const rows = updates
    .map((row: any) => {
      const studentId = cleanText(row?.student_id);
      if (!studentId || !allowed.has(studentId)) return null;

      return {
        institution_id: institutionId,
        student_id: studentId,
        gender: normalizeGender(row?.gender),
        birthdate: normalizeDateYmd(row?.birthdate),
        birth_place: normalizeNullableText(row?.birth_place),
        nationality: normalizeNullableText(row?.nationality),
        is_repeater: normalizeBool(row?.is_repeater),
        lv2: normalizeNullableText(row?.lv2)?.toUpperCase() ?? null,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean) as any[];

  if (!rows.length) return NextResponse.json({ ok: true, updated: 0 });

  const { data, error } = await srv
    .from("student_roster_details")
    .upsert(rows, { onConflict: "institution_id,student_id" })
    .select("student_id");

  if (error) {
    return NextResponse.json(
      {
        error:
          "La table student_roster_details est absente. Exécute la migration 20260521_student_roster_details.sql dans Supabase, puis réessaie.",
        details: error.message,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, updated: (data || []).length });
}
