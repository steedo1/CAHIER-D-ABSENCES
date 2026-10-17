import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { aggregateSchoolCycleRoster } from "@/lib/school-cycle-roster";
import {
  aggregateStudentProgramRoster, readStudentProgramSettings,
} from "@/lib/school-student-programs";
import { createSchoolSubjectResolver } from "@/lib/school-subject-identifiers";
import {
  groupScopedClassesByCycle,
  parseSchoolCyclesSettings,
  inferSchoolCycleFromLevel,
  resolveSchoolCycleForClass,
} from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = [
  "admin",
  "super_admin",
  "founder",
] as const;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const access = await requireInstitutionRole(supa, srv, ALLOWED_ROLES);
  if ("error" in access) {
    return reply({ error: access.error }, access.error === "unauthorized" ? 401 : 403);
  }

  // Server-authorized institution only, never an institution_id from the URL.
  const institutionId = access.instId;
  const { data: institution, error: instErr } = await srv
    .from("institutions")
    .select("id,name,settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  if (instErr || !institution) return reply({ error: "school_load_failed" }, 503);

  const configuration = parseSchoolCyclesSettings(institution.settings_json);
  if (!configuration.enabled) {
    // Keep legacy institutions entirely out of this new navigation.
    return reply({ ok: true, enabled: false });
  }

  const { data: activeYear, error: yearErr } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (yearErr) return reply({ error: "academic_year_load_failed" }, 503);

  // Do not silently pick a different year in the new cycle dashboard.
  const year = String(activeYear?.code || "");
  const classes: Array<{
    id: string; institution_id: string; academic_year: string;
    label: string; level: string | null;
  }> = [];

  if (year) {
    // Bounded pagination instead of pulling enrollment/grade tables on page load.
    for (let offset = 0; offset < 10000; offset += 500) {
      const { data: page, error } = await srv
        .from("classes")
        .select("id,institution_id,academic_year,label,level")
        .eq("institution_id", institutionId)
        .eq("academic_year", year)
        .order("id")
        .range(offset, offset + 499);
      if (error) return reply({ error: "classes_load_failed" }, 503);
      classes.push(...(page || []));
      if (!page || page.length < 500) break;
      if (offset === 9500) return reply({ error: "too_many_classes" }, 503);
    }
  }

  const grouped = groupScopedClassesByCycle(classes, institutionId, year, configuration);
  const reviewNeeded = classes
    .filter((row) => !configuration.classCycleById[row.id] &&
      !inferSchoolCycleFromLevel(row.level))
    .map(({ id, label, level }) => ({ id, label, level }));
  const outsideEnabledCycles = classes
    .filter((row) => !configuration.enabledCycles.includes(
      resolveSchoolCycleForClass(row, configuration)))
    .map(({ id, label, level }) => ({ id, label, level }));

  if (request?.nextUrl.searchParams.get("view") === "navigation") {
    return reply({ ok: true, enabled: true, academicYear: year || null,
      classes: configuration.enabledCycles.flatMap(cycle => grouped[cycle].map(row => ({
        id: row.id, label: (row as typeof classes[number]).label, level: row.level, cycle,
      }))),
    });
  }

  const enrollments: Array<{ class_id: string; student_id: string; end_date: string | null }> = [];
  const teachers: Array<{ class_id: string; teacher_id: string; subject_id: string | null; end_date: string | null }> = [];
  const allClassIds = classes.map((row) => row.id);

  // Pagination is mandatory here. Supabase may cap requested rows at 1,000,
  // even when a larger .limit() is supplied. A partial result is NOT a
  // trustworthy headcount. Use stable UUID ordering and 500-row pages.
  for (let i = 0; i < allClassIds.length; i += 40) {
    const ids = allClassIds.slice(i, i + 40);
    let enrollComplete = false;
    let teacherComplete = false;
    let offset = 0;
    while (!enrollComplete || !teacherComplete) {
      if (offset >= 20000) return reply({ error: "cycle_roster_too_large" }, 503);
      const pages: [
        { data: typeof enrollments | null; error: { message: string } | null },
        { data: typeof teachers | null; error: { message: string } | null },
      ] = await Promise.all([
        enrollComplete
          ? Promise.resolve({ data: [], error: null })
          : srv.from("class_enrollments")
            .select("class_id,student_id,end_date")
            .eq("institution_id", institutionId)
            .in("class_id", ids)
            .is("end_date", null)
            .order("id")
            .range(offset, offset + 499),
        teacherComplete
          ? Promise.resolve({ data: [], error: null })
          : srv.from("class_teachers")
            .select("class_id,teacher_id,subject_id,end_date")
            .eq("institution_id", institutionId)
            .in("class_id", ids)
            .is("end_date", null)
            .order("id")
            .range(offset, offset + 499),
      ]);
      const enroll = pages[0];
      const assigned = pages[1];
      if (enroll.error || assigned.error || !enroll.data || !assigned.data) {
        return reply({ error: "cycle_roster_load_failed" }, 503);
      }
      enrollments.push(...enroll.data);
      teachers.push(...assigned.data);
      enrollComplete ||= enroll.data.length < 500;
      teacherComplete ||= assigned.data.length < 500;
      offset += 500;
    }
  }

  const scopedClasses = configuration.enabledCycles.flatMap((cycle) =>
    grouped[cycle].map((row) => ({ id: row.id, cycle })));
  const headcount = aggregateSchoolCycleRoster(
    scopedClasses, enrollments, teachers,
  );
  const schoolPrograms = readStudentProgramSettings(institution.settings_json);
  const studentPrograms = aggregateStudentProgramRoster(
    configuration, schoolPrograms.years[year], scopedClasses, enrollments,
  );
  const classifiedSubjectIds = Array.from(new Set(Object.values(
    configuration.subjectTracksByCycle).flatMap((mappings) =>
      Object.keys(mappings || {}))));
  let subjects: Array<{ id: string; name: string }> = [];
  let subjectAliases: Array<{ id: string; subject_id: string }> = [];
  if (classifiedSubjectIds.length) {
    const allowed = await srv.from("institution_subjects")
      .select("id,subject_id,custom_name")
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .in("subject_id", classifiedSubjectIds)
      .limit(501);
    if (allowed.error) return reply({ error: "subjects_load_failed" }, 503);
    const active = allowed.data || [];
    subjectAliases = active;
    const actualIds = Array.from(new Set(active.map((row) => row.subject_id)));
    if (actualIds.length) {
      const global = await srv.from("subjects")
        .select("id,name").in("id", actualIds).limit(501);
      if (global.error) return reply({ error: "subjects_load_failed" }, 503);
      const globalNames = new Map((global.data || [])
        .map((row) => [row.id, row.name]));
      subjects = active.map((row) => ({
        id: row.subject_id,
        name: String(row.custom_name || globalNames.get(row.subject_id) || ""),
      })).filter((row) => Boolean(row.name));
    }
  }

  const namesById = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const resolveSubject = createSchoolSubjectResolver(subjectAliases);
  const cycleForClass = new Map(configuration.enabledCycles.flatMap((cycle) =>
    grouped[cycle].map((row) => [row.id, cycle] as const)));
  const byProgram = Object.fromEntries(configuration.enabledCycles.map((cycle) => [
    cycle,
    Object.fromEntries((configuration.teachingTracksByCycle[cycle] || [])
      .map((track) => {
        const activeIds = Object.entries(configuration.subjectTracksByCycle[cycle] || {})
          .filter(([subjectId, tracks]) => tracks.includes(track) && namesById.has(subjectId))
          .map(([subjectId]) => subjectId);
        const activeSet = new Set(activeIds);
        const assignedTeacherIds = new Set(teachers
          .filter((row) => !row.end_date && cycleForClass.get(row.class_id) === cycle &&
            Boolean(row.subject_id && activeSet.has(resolveSubject(row.subject_id) || "")))
          .map((row) => row.teacher_id));
        return [
          track,
          {
            subjects: activeIds.map((subjectId) =>
              ({ id: subjectId, name: namesById.get(subjectId) || "" }))
              .sort((a, b) => a.name.localeCompare(b.name, "fr")),
            uniqueTeachers: assignedTeacherIds.size,
          },
        ];
      })),
  ]));

  return reply({
    ok: true,
    enabled: true,
    institution: { name: institution.name },
    academicYear: year || null,
    configuration: {
      enabledCycles: configuration.enabledCycles,
      teachingTracksByCycle: configuration.teachingTracksByCycle,
      defaultView: configuration.defaultView,
    },
    totalClasses: classes.length,
    uniqueStudents: headcount.uniqueStudents,
    uniqueTeachers: headcount.uniqueTeachers,
    studentPrograms,
    programs: byProgram,
    reviewNeeded,
    outsideEnabledCycles,
    cycles: Object.fromEntries(configuration.enabledCycles.map((cycle) => [
      cycle,
      {
        classes: grouped[cycle].map((row) => ({
          id: row.id,
          label: (row as typeof classes[number]).label,
          level: row.level,
        })),
        count: grouped[cycle].length,
        students: headcount.byCycle[cycle].students,
        teachers: headcount.byCycle[cycle].teachers,
      },
    ])),
  });
}
