import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { loadStatisticsGradePeriods } from "@/lib/server/general-statistics-periods";
import type { StatisticsGradePeriod } from "@/lib/general-statistics-averages";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass, type TeachingTrack } from "@/lib/school-cycles";
import {
  expandPedagogicalEnrollments, programsForStudent, readStudentProgramSettings,
} from "@/lib/school-student-programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_ALLOWED_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "file_correspondent",
  "finance_manager",
  "finance",
]);

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .toLowerCase();
}

function normalizeAffectation(value: unknown): boolean | null {
  const v = normalize(value).replace(/[_-]+/g, " ");
  if (!v || v === "unknown") return null;
  if (v.includes("non") && v.includes("affect")) return false;
  if (v.includes("affect")) return true;
  return null;
}

function normalizeScholarship(value: unknown): boolean | null {
  const v = normalize(value).replace(/[_-]+/g, " ");
  if (!v || v === "unknown") return null;
  if (v.includes("non") && (v.includes("bours") || v.includes("scholar"))) return false;
  if (v.includes("bours") || v.includes("scholar")) return true;
  if (["oui", "yes", "true", "1"].includes(v)) return true;
  if (["non", "no", "false", "0"].includes(v)) return false;
  return null;
}

function roleMatchesInstitution(role: string, roleInstitutionId: unknown, institutionId: string) {
  if (role === "super_admin") return true;
  const roleInst = clean(roleInstitutionId);
  return !roleInst || roleInst === institutionId;
}

async function currentAcademicYear(institutionId: string) {
  const srv = getSupabaseServiceClient();
  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current?.code) return clean(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? clean(latest.code) : null;
}

async function requireContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return { error: NextResponse.json({ error: profileError.message }, { status: 400 }) };
  }

  const { data: roleRows, error: roleError } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleError) {
    return { error: NextResponse.json({ error: roleError.message }, { status: 400 }) };
  }

  const allowedRows = (roleRows || []).filter((row: any) =>
    READ_ALLOWED_ROLES.has(clean(row?.role)),
  );

  let institutionId = clean((profile as any)?.institution_id);
  if (!institutionId) {
    institutionId = clean(allowedRows.find((row: any) => row?.institution_id)?.institution_id);
  }

  if (!institutionId) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  const allowed = allowedRows.some((row: any) =>
    roleMatchesInstitution(clean(row?.role), row?.institution_id, institutionId),
  );

  if (!allowed) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const canReadAcademic = allowedRows.some((row: any) =>
    ["admin", "super_admin", "file_correspondent"].includes(clean(row?.role)) &&
    roleMatchesInstitution(clean(row?.role), row?.institution_id, institutionId),
  );
  return { srv, institutionId, canReadAcademic };
}

export async function GET() {
  const ctx = await requireContext();
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, canReadAcademic } = ctx;
  const { data: institution, error: configurationError } = await srv.from("institutions")
    .select("settings_json").eq("id", institutionId).maybeSingle();
  if (configurationError || !institution) {
    return NextResponse.json({ error: "school_configuration_unavailable" }, { status: 503 });
  }
  const settingsJson = institution.settings_json;
  const school = parseSchoolCyclesSettings(settingsJson);
  const schoolConfiguration = {
    enabled: school.enabled,
    enabled_cycles: school.enabledCycles,
    teaching_tracks_by_cycle: school.teachingTracksByCycle,
  };
  const academicYear = await currentAcademicYear(institutionId);

  if (!academicYear) {
    return NextResponse.json({ items: [], academic_year: null, school_configuration: schoolConfiguration });
  }

  const [enrollmentsResult, yearProfilesResult] = await Promise.all([
    srv
      .from("class_enrollments")
      .select(`
        student_id,
        class_id,
        students:student_id (
          id,
          first_name,
          last_name,
          full_name,
          matricule,
          gender,
          birthdate,
          nationality,
          lv2,
          regime,
          is_affecte,
          is_boarder
        ),
        classes:class_id!inner (
          id,
          label,
          level,
          academic_year,
          institution_id,
          education_type,
          formation_code,
          formation_level_code
        )
      `)
      .eq("institution_id", institutionId)
      .eq("classes.institution_id", institutionId)
      .eq("classes.academic_year", academicYear)
      .is("end_date", null)
      .limit(50000),
    srv
      .from("student_year_profiles")
      .select("student_id,is_boarder,affectation_status,scholarship_status")
      .eq("institution_id", institutionId)
      .eq("academic_year", academicYear)
      .limit(50000),
  ]);

  if (enrollmentsResult.error) {
    return NextResponse.json({ error: enrollmentsResult.error.message }, { status: 400 });
  }

  if (yearProfilesResult.error) {
    return NextResponse.json({ error: yearProfilesResult.error.message }, { status: 400 });
  }

  const annualByStudent = new Map<string, any>();
  for (const row of yearProfilesResult.data || []) {
    const studentId = clean((row as any)?.student_id);
    if (studentId) annualByStudent.set(studentId, row);
  }

  // Build programme membership from the authoritative enrollment and the
  // opt-in school mapping. An Arabic-linked class does not enroll/count the
  // pupil a second time. Missing mappings stay unclassified, never French by default.
  const programmeClasses = new Map<string, Partial<Record<TeachingTrack, string>>>();
  if (school.enabled) {
    const { data: scopedClasses, error: classesError } = await srv.from("classes")
      .select("id,level,institution_id,academic_year")
      .eq("institution_id", institutionId).eq("academic_year", academicYear).limit(1000);
    if (classesError || !scopedClasses || scopedClasses.length >= 1000) {
      return NextResponse.json({ error: "school_program_classes_unavailable" }, { status: 503 });
    }
    const knownClasses = scopedClasses.map((row) => ({
      id: row.id, level: row.level, cycle: resolveSchoolCycleForClass(row, school),
    }));
    const currentEnrollments = (enrollmentsResult.data || []).map((row: any) => ({
      class_id: clean(row.class_id), student_id: clean(row.student_id), end_date: null,
    }));
    const yearPolicy = readStudentProgramSettings(settingsJson).years[academicYear];
    for (const entry of expandPedagogicalEnrollments(school, yearPolicy, knownClasses, currentEnrollments)) {
      const cls = knownClasses.find((row) => row.id === entry.class_id);
      if (!cls) continue;
      const tracks = programsForStudent(yearPolicy?.classes[cls.id], entry.student_id,
        school.teachingTracksByCycle[cls.cycle] || []);
      const record = programmeClasses.get(entry.student_id) || {};
      for (const track of tracks) {
        // Prefer the student's original class if it also offers the programme.
        if (!record[track] || currentEnrollments.some((home) =>
          home.student_id === entry.student_id && home.class_id === cls.id)) {
          record[track] = cls.id;
        }
      }
      programmeClasses.set(entry.student_id, record);
    }
  }

  const seen = new Set<string>();
  const items: any[] = [];

  for (const row of enrollmentsResult.data || []) {
    const student = (row as any)?.students || {};
    const cls = (row as any)?.classes || {};
    const id = clean(student?.id || (row as any)?.student_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const annual = annualByStudent.get(id);
    const annualAffectation = normalizeAffectation(annual?.affectation_status);
    const annualScholarship = normalizeScholarship(annual?.scholarship_status);
    const fullName =
      [clean(student?.last_name).toUpperCase(), clean(student?.first_name)]
        .filter(Boolean)
        .join(" ") || clean(student?.full_name) || "—";

    items.push({
      id,
      matricule: clean(student?.matricule) || null,
      full_name: fullName,
      first_name: clean(student?.first_name) || null,
      last_name: clean(student?.last_name) || null,
      class_id: clean(cls?.id || (row as any)?.class_id) || null,
      class_label: clean(cls?.label) || null,
      level: clean(cls?.level) || null,
      ...(school.enabled ? {
        school_cycle: resolveSchoolCycleForClass(cls, school),
        teaching_tracks: Object.keys(programmeClasses.get(id) || {}),
        program_class_ids: programmeClasses.get(id) || {},
      } : {}),
      gender: clean(student?.gender) || null,
      birthdate: clean(student?.birthdate) || null,
      nationality: clean(student?.nationality) || null,
      lv2: clean(student?.lv2) || null,
      is_boarder:
        typeof annual?.is_boarder === "boolean"
          ? annual.is_boarder
          : typeof student?.is_boarder === "boolean"
            ? student.is_boarder
            : null,
      is_affecte:
        annualAffectation !== null
          ? annualAffectation
          : typeof student?.is_affecte === "boolean"
            ? student.is_affecte
            : null,
      is_scholarship: annualScholarship,
      regime: clean(student?.regime) || null,
    });
  }

  items.sort((a, b) => {
    const name = clean(a.full_name).localeCompare(clean(b.full_name), "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (name) return name;
    const cls = clean(a.class_label).localeCompare(clean(b.class_label), "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (cls) return cls;
    return clean(a.matricule).localeCompare(clean(b.matricule), "fr", {
      sensitivity: "base",
      numeric: true,
    });
  });

  let academicPeriods: StatisticsGradePeriod[] = [];
  let academicFilterError: string | null = null;
  if (canReadAcademic) {
    try {
      const classes = new Map<string, any>();
      for (const row of enrollmentsResult.data || []) {
        const cls = (row as any).classes;
        if (cls?.id) classes.set(cls.id, cls);
      }
      academicPeriods = await loadStatisticsGradePeriods(srv, institutionId, academicYear, Array.from(classes.values()), settingsJson);
    } catch {
      academicFilterError = "Les périodes scolaires n’ont pas pu être chargées. Actualisez la page pour utiliser les filtres de moyenne.";
    }
  }
  return NextResponse.json({
    items,
    academic_year: academicYear,
    can_filter_averages: canReadAcademic,
    academic_periods: academicPeriods,
    academic_filter_error: academicFilterError,
    school_configuration: schoolConfiguration,
  });
}
