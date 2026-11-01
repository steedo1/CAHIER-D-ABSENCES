import type { TeachingTrack } from "@/lib/school-cycles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";
import { expandPedagogicalEnrollments, readStudentProgramSettings, programsForStudent } from "@/lib/school-student-programs";

export type SchoolRosterClass = { id: string; level?: string | null; academic_year?: string | null };
/** Reverify the persisted teaching links without creating duplicate enrollments. */
export async function loadLinkedClassEnrollments(service: SupabaseClient, institutionId: string,
  classroom: SchoolRosterClass, settings: unknown) {
  const school = parseSchoolCyclesSettings(settings);
  if (!school.enabled) return [];
  const year = classroom.academic_year || "";
  const policy = readStudentProgramSettings(settings).years[year];
  const links = policy?.classes[classroom.id]?.linkedStudentIds || [];
  if (!links.length) return [];
  // Scope every home to this academic year; historical active memberships or
  // deleted pupils must not blank the entire Arabic list. A database error
  // still fails closed: never guess or expose unverified membership.
  const { data: homes, error: homeError } = await service.from("class_enrollments")
    .select("student_id,class_id,start_date").eq("institution_id", institutionId)
    .in("student_id", links).is("end_date", null).limit(3501);
  if (homeError || !homes || homes.length >= 3501) throw Error("STUDENT_PROGRAM_LINK_STALE");
  if (!homes.length) {
    console.warn("[arabic-roster] ignored historical links without active enrollment", { count: links.length });
    return [];
  }
  const { data: sources, error: classError } = await service.from("classes")
    .select("id,level,academic_year,institution_id").eq("institution_id", institutionId)
    .eq("academic_year", year).in("id", [...new Set(homes.map(row => row.class_id))]).limit(3501);
  if (classError || !sources || sources.length >= 3501) throw Error("STUDENT_PROGRAM_LINK_STALE");
  const classIds = new Set(sources.map(source => source.id));
  const yearHomes = homes.filter(row => classIds.has(row.class_id));
  const counts = new Map<string, number>();
  for (const row of yearHomes) counts.set(row.student_id, (counts.get(row.student_id) || 0) + 1);
  // Ambiguous administrative membership must never authorize an Arabic link.
  const unambiguousHomes = yearHomes.filter(row => counts.get(row.student_id) === 1);
  const classes = [...sources.filter(row => row.id !== classroom.id), classroom]
    .map(row => ({ id: row.id, level: row.level, cycle: resolveSchoolCycleForClass(row, school) }));
  const allowed = [...new Set(expandPedagogicalEnrollments(school, policy, classes, unambiguousHomes)
    .filter(row => row.class_id === classroom.id).map(row => row.student_id))];
  if (allowed.length !== links.length) {
    console.warn("[arabic-roster] excluded outdated or invalid pedagogical links", {
      excludedCount: links.length - allowed.length,
    });
  }
  if (!allowed.length) return [];
  const { data: students, error: studentError } = await service.from("students")
    .select("id,first_name,last_name,full_name,full_name_ar,matricule,gender,birthdate,birth_place,parent_names,parent_contact,nationality,is_repeater,lv2,is_affecte,is_boarder")
    .eq("institution_id", institutionId).in("id", allowed).limit(701);
  if (studentError || !students) throw Error("STUDENT_SCOPE_INVALID");
  if (students.length !== allowed.length) {
    console.warn("[arabic-roster] excluded links to missing student records", {
      excludedCount: allowed.length - students.length,
    });
  }
  return students.map(student => ({
    student_id: student.id, start_date: unambiguousHomes.find(home => home.student_id === student.id)?.start_date,
    students: student,
  }));
}

/** Add a bounded membership check only for explicitly configured schools.
 * The existing route remains responsible for evaluation ownership and locks. */
export async function specializedGradeStudentsAllowed(service: SupabaseClient, actorId: string,
  classId: string, studentIds: readonly string[], ownerProfileId?: string | null, track?: TeachingTrack | null): Promise<boolean> {
  const [profile, classroom] = await Promise.all([
    service.from("profiles").select("institution_id").eq("id", actorId).maybeSingle(),
    service.from("classes").select("id,institution_id,level,academic_year").eq("id", classId).maybeSingle(),
  ]);
  if (classroom.error || !classroom.data?.institution_id) return false;
  const institutionId = classroom.data.institution_id;
  const { data: institution, error } = await service.from("institutions").select("settings_json")
    .eq("id", institutionId).maybeSingle();
  if (error || !institution) return false;
  if (!parseSchoolCyclesSettings(institution.settings_json).enabled) return true;
  if (profile.error || profile.data?.institution_id !== institutionId) return false;
  if (ownerProfileId !== undefined && ownerProfileId !== actorId) {
    const { data: roles, error: roleError } = await service.from("user_roles").select("role")
      .eq("profile_id", actorId).eq("institution_id", institutionId);
    if (roleError || !roles?.some(row => ["admin", "super_admin", "educator"].includes(row.role))) return false;
  }
  const [enrolled, linked] = await Promise.all([
    service.from("class_enrollments").select("student_id").eq("institution_id", institutionId)
      .eq("class_id", classId).is("end_date", null).limit(1501),
    loadLinkedClassEnrollments(service, institutionId, classroom.data, institution.settings_json),
  ]);
  if (enrolled.error || !enrolled.data || enrolled.data.length >= 1501) return false;
  const school = parseSchoolCyclesSettings(institution.settings_json);
  const cycle = resolveSchoolCycleForClass(classroom.data, school);
  const policy = readStudentProgramSettings(institution.settings_json).years[classroom.data.academic_year || ""]?.classes[classId];
  if (track && (cycle !== "primary" || !(policy?.tracks || school.teachingTracksByCycle.primary || []).includes(track))) return false;
  const allowed = new Set([...enrolled.data, ...linked].filter(row => !track ||
    (policy ? programsForStudent(policy, row.student_id, school.teachingTracksByCycle.primary || []) : school.teachingTracksByCycle.primary || []).includes(track)).map(row => row.student_id));
  return studentIds.every(id => allowed.has(id));
}
