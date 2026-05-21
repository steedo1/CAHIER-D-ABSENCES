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

function fullName(row: any) {
  const direct = String(row?.full_name || "").trim();
  if (direct) return direct;

  return [row?.last_name, row?.first_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
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
    new Set((roles || []).map((row: any) => String(row.profile_id || "")).filter(Boolean)),
  );

  if (!allEducatorIds.length) return [];

  const { data: assignments, error: assignErr } = await srv
    .from("educator_class_assignments")
    .select("profile_id,level,class_id")
    .eq("institution_id", institutionId)
    .in("profile_id", allEducatorIds);

  // Compatibilité : si la nouvelle table n’existe pas encore,
  // on conserve l'ancien comportement et on affiche tous les éducateurs.
  if (assignErr) {
    return loadEducatorProfiles(allEducatorIds);
  }

  const rows = Array.isArray(assignments) ? assignments : [];
  if (rows.length === 0) {
    return loadEducatorProfiles(allEducatorIds);
  }

  const level = String(classLevel || "").trim();
  const matchingIds = Array.from(
    new Set(
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

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();

  if (!classId) {
    return NextResponse.json({ error: "missing_class_id" }, { status: 400 });
  }

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const institutionId = String(me?.institution_id || "").trim();
  if (!institutionId) {
    return NextResponse.json({ error: "no_institution" }, { status: 400 });
  }

  const url = new URL(req.url);
  const academicYearParam = String(url.searchParams.get("academic_year") || "").trim();
  const academicYear = academicYearParam || (await getCurrentAcademicYear(institutionId));

  const { data: cls, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,head_teacher_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) {
    return NextResponse.json({ error: classErr.message }, { status: 400 });
  }

  if (!cls) {
    return NextResponse.json({ error: "class_not_found" }, { status: 404 });
  }

  if (academicYear && academicYear !== "all" && String(cls.academic_year || "") !== academicYear) {
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
    getEducators(institutionId, classId, cls.level),
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

  if (enrollErr) {
    return NextResponse.json({ error: enrollErr.message }, { status: 400 });
  }

  const students = (enrollments || [])
    .map((row: any) => {
      const s = row.students || {};
      const name = fullName(s) || "—";

      return {
        id: String(s.id || row.student_id || ""),
        matricule: s.matricule ? String(s.matricule) : null,
        full_name: name,
        first_name: s.first_name ?? null,
        last_name: s.last_name ?? null,
        gender: s.gender ?? null,
        birthdate: s.birthdate ?? null,
        birth_place: s.birth_place ?? null,
        nationality: s.nationality ?? null,
        is_repeater: typeof s.is_repeater === "boolean" ? s.is_repeater : null,
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
    String(institution.name || "").trim() ||
    String(settings.institution_name || settings.school_name || settings.name || "").trim();

  return NextResponse.json({
    ok: true,
    class: {
      id: String(cls.id),
      label: String(cls.label || cls.code || "Classe"),
      level: cls.level ?? null,
      code: cls.code ?? null,
      academic_year: cls.academic_year ?? null,
      official_track_code: cls.official_track_code ?? null,
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
          code: academicYear ?? cls.academic_year ?? null,
          label: academicYear ?? cls.academic_year ?? null,
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
